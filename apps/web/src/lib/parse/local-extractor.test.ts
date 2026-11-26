import { describe, expect, it } from 'vitest';
import { createRuntime } from '../api/runtime';
import { DestinationResolver, ParseService } from './index';
import { poiClient } from '../geo/poi-client';
import { localIntent, searchExtractor, type LocalExtractor } from './local-extractor';

type Evidence = Awaited<ReturnType<LocalExtractor>>;

function at(prompt: string, text: string, from = 0) {
  const start = prompt.indexOf(text, from);
  if (start === -1) throw new Error(`Missing test evidence: ${text}`);
  return { text, start, end: start + text.length };
}

describe('local extraction', () => {
  it('binds each duration and mode to its destination and keeps independent unbounded stops', () => {
    const prompt = 'Near T&T, less than 5 minutes cycling to UW, within 20 minutes by LRT to Kitchener GO, around 5 minutes on foot to a grocery store';
    const trip = (source: string, destination: string, duration?: string, mode?: [string, string]) => {
      const scope = at(prompt, source);
      return {
        source: scope, destination: at(prompt, destination, scope.start),
        duration: duration ? at(prompt, duration, scope.start) : null,
        modeSpans: mode ? [{ ...at(prompt, mode[0], scope.start), choice: mode[1] }] : [], amenity: false,
      };
    };
    const evidence: Evidence = { spans: {}, trips: [
      trip('Near T&T', 'T&T'),
      { ...trip('less than 5 minutes cycling to UW', 'UW', '5 minutes', ['cycling', 'bike']), strength: 'prefer' },
      trip('within 20 minutes by LRT to Kitchener GO', 'Kitchener GO', '20 minutes', ['LRT', 'transit']),
      { ...trip('around 5 minutes on foot to a grocery store', 'grocery store', '5 minutes', ['on foot', 'walk']),
        amenity: true, category: 'grocery', strength: 'require' },
    ] };
    const targets = localIntent(prompt, evidence, []).travelTargets;
    expect(targets.map(t => [t.label, t.maxMinutes, t.mode, t.hard, t.category])).toEqual([
      ['T&T', undefined, 'transit', true, undefined], ['UW', 5, 'bike', true, undefined],
      ['Kitchener GO', 20, 'transit', true, undefined], ['grocery store', 5, 'walk', false, 'grocery'],
    ]);
    // A mode and duration from another destination cannot change the T&T trip.
    evidence.trips[0].modeSpans = evidence.trips[1].modeSpans;
    expect(localIntent(prompt, evidence, []).travelTargets[0].mode).toBe('transit');
  });

  it('combines explicit local evidence with the existing field semantics', () => {
    const prompt = 'Condo in Beechwood, under twenty-five hundred dollars, reasonably priced, two bedrooms, one and a half baths, at least 650 sqft, built after 1990, central AC, cats allowed, unfurnished, no parking, in-suite laundry, utilities included, available by September 2 2027, short-term lease';
    const evidence: Evidence = { trips: [], spans: {
      rent: [{ ...at(prompt, 'twenty-five hundred dollars'), phrase: 'under twenty-five hundred dollars', value: 2500, bound: 'min' }],
      bedrooms: [{ ...at(prompt, 'two'), bound: 'unspecified' }],
      bathrooms: [at(prompt, 'one and a half')],
      availableBy: [at(prompt, 'September 2 2027')],
      leaseTerm: [{ ...at(prompt, 'short-term lease'), choice: 'short_term', strength: 'prefer' }],
      priceFairness: [{ ...at(prompt, 'reasonably priced'), choice: ['reasonable'] }],
    } };
    const intent = localIntent(prompt, evidence, [{ kind: 'neighbourhood', id: 'WPB', name: 'Beechwood', number: null }]);
    expect(Object.keys(intent.criteria)).toHaveLength(14);
    expect(intent.criteria).not.toHaveProperty('priceFairness');
    expect(intent.criteria).toMatchObject({
      rent: { value: { max: 2500 }, hard: true },
      bedrooms: { value: { min: 2, max: 2 } }, bathrooms: { value: { min: 1.5, max: 1.5 } },
      sizeSqft: { value: { min: 650 } }, buildingAge: { value: { builtAfter: 1990 } },
      availableBy: { value: '2027-09-02' }, leaseTerm: { value: 'short_term', hard: true },
      parking: { value: false }, furnished: { value: false },
    });
    expect(intent.areas).toEqual([{ kind: 'neighbourhood', id: 'WPB' }]);
  });

  it('keeps basic parsing available when the local service fails', async () => {
    const service = new ParseService({ extractor: async () => { throw new Error('unavailable'); } });
    const result = await service.parse({ prompt: '2 bed condo under $2000' }, 'ip');
    expect(result.parser).toBe('fallback');
    expect(result.intent.criteria.rent?.value).toEqual({ max: 2000 });
    expect(result.notice).toContain('Local extraction unavailable');
  });

  it('does not treat a percentage or result count as a listing quantity', () => {
    const prompt = 'Cheapest 10%, minimum 12 results, 2 bedrooms';
    const intent = localIntent(prompt, {
      trips: [],
      spans: {
        rent: [
          { ...at(prompt, '10'), value: 10, bound: 'max' },
          { ...at(prompt, '10%'), value: 1000, bound: 'max' },
        ],
        bedrooms: [{ ...at(prompt, '12'), phrase: 'minimum 12', bound: 'min' }],
      },
    }, []);
    expect(intent.criteria).toEqual({ bedrooms: { value: { min: 2, max: 2 }, hard: true } });
    expect(intent.sortBy).toBe('lowest_rent');
  });

  it('uses an explicit sort phrase only for sorting', () => {
    const prompt = 'Please ignore my commute and show newest listings';
    const evidence = at(prompt, 'newest listings');
    const intent = localIntent(prompt, {
      trips: [],
      spans: { sort: [evidence], furnished: [{ ...evidence, choice: 'no' }] },
    }, []);
    expect(intent.criteria).toEqual({});
    expect(intent.sortBy).toBe('newest');
  });

  it('preserves a spoken rent range with both amounts in the same source clause', () => {
    const prompt = 'Between fifteen hundred dollars and twenty-five hundred dollars';
    const rent = [
      { ...at(prompt, 'fifteen hundred dollars'), phrase: 'Between fifteen hundred dollars', value: 1500 },
      { ...at(prompt, 'twenty-five hundred dollars'), value: 2500 },
    ];
    expect(localIntent(prompt, { trips: [], spans: { rent } }, []).criteria.rent?.value).toEqual({ min: 1500, max: 2500 });
  });

  it('reads explicit floor-area bounds deterministically and keeps floor-area numbers out of rent', () => {
    for (const [prompt, value] of [
      ['Has to have 2.5 baths and at least 1,300 square feet.', { min: 1300 }],
      ['A maximum of 700 sq ft and one bedroom.', { max: 700 }],
      ['At least 950 and at most 1,250 square feet.', { min: 950, max: 1250 }],
      ['An apartment between 580 and 760 square feet.', { min: 580, max: 760 }],
      ['A 2 bedroom apartment, 800 to 1,050 square feet.', { min: 800, max: 1050 }],
    ] as const) {
      expect(localIntent(prompt, { trips: [], spans: {} }, []).criteria).toMatchObject({ sizeSqft: { value, hard: true } });
    }
    const prompt = 'At least 950 and at most 1,250 square feet.';
    const intent = localIntent(prompt, { trips: [], spans: {
      rent: [at(prompt, '950')],
      sizeSqft: [at(prompt, '1,250 square feet')],
    } }, []);
    expect(intent.criteria).toEqual({ sizeSqft: { value: { min: 950, max: 1250 }, hard: true } });
  });

  it('keeps stated room-count and construction-year bounds', () => {
    const prompt = 'Two to four bedrooms, at most 2.5 baths, built after 2001 but no later than 2016.';
    expect(localIntent(prompt, { trips: [], spans: {} }, []).criteria).toEqual({
      bedrooms: { value: { min: 2, max: 4 }, hard: true },
      bathrooms: { value: { max: 2.5 }, hard: true },
      buildingAge: { value: { builtAfter: 2001, builtBefore: 2016 }, hard: true },
    });
    const historical = 'My old place was a 700 sq ft condo. I need 1+ bedrooms.';
    const criteria = localIntent(historical, { trips: [], spans: { sizeSqft: [at(historical, '700 sq ft')] } }, []).criteria;
    expect(criteria.sizeSqft).toBeUndefined();
    expect(criteria.bedrooms).toEqual({ value: { min: 1 }, hard: true });
  });

  it('distinguishes explicit feature requests from waived filters', () => {
    const prompt = 'Parking isn’t needed. I need a washer and dryer inside the unit and utilities in the rent.';
    const criteria = localIntent(prompt, { trips: [], spans: { parking: [{ ...at(prompt, 'Parking'), choice: 'yes' }] } }, []).criteria;
    expect(criteria).toEqual({
      laundryInSuite: { value: true, hard: true },
      utilitiesIncluded: { value: true, hard: true },
    });
    const excluded = 'No on-site parking, and ideally no utilities included.';
    expect(localIntent(excluded, { trips: [], spans: {} }, []).criteria).toEqual({
      parking: { value: false, hard: true },
      utilitiesIncluded: { value: false, hard: false },
    });
  });

  it('keeps abandoned travel and waived features out of the fallback', () => {
    const prompt = "Ignore the 15 minute walk to the park. No parking space required, no furnishing requirement, and don't include utilities in the rent. I need room for pets.";
    const intent = localIntent(prompt, { trips: [], spans: {
      unitTypes: [at(prompt, 'room')], parking: [{ ...at(prompt, 'parking'), choice: 'yes' }],
      furnished: [{ ...at(prompt, 'furnishing'), choice: 'no' }],
    } }, []);
    expect(intent.travelTargets).toEqual([]);
    expect(intent.criteria).toMatchObject({ utilitiesIncluded: { value: false, hard: true } });
    for (const field of ['parking', 'furnished', 'unitTypes']) expect(intent.criteria).not.toHaveProperty(field);
    const revised = "I've stopped commuting to UW. No need for a parking space. Furnished would be a bonus.";
    const { criteria, travelTargets } = localIntent(revised, { trips: [], spans: {} }, []);
    expect(travelTargets).toEqual([]);
    expect(criteria).toEqual({ furnished: { value: true, hard: false } });
  });

  it('keeps independent school targets with travel details after each destination', () => {
    const prompt = 'An elementary school in 8 minutes by bike and a high school around 15 minutes on foot';
    const intent = localIntent(prompt, { spans: {}, trips: [
      { destination: at(prompt, 'elementary school'), source: at(prompt, 'An elementary school in 8 minutes by bike'),
        duration: at(prompt, '8 minutes'), modeSpans: [], amenity: true, category: 'school' },
      { destination: at(prompt, 'high school'), source: at(prompt, 'a high school around 15 minutes on foot'),
        duration: at(prompt, '15 minutes'), modeSpans: [], amenity: true, category: 'school' },
    ] }, []);
    expect(intent.travelTargets).toMatchObject([
      { schoolLevel: 'elementary', mode: 'bike', maxMinutes: 8, hard: true },
      { schoolLevel: 'secondary', mode: 'walk', maxMinutes: 15, hard: false },
    ]);
  });

  it('preserves a compound unit type, a rent ceiling after the amount, and a move-in year', () => {
    const prompt = 'A studio or a basement apartment for seventeen hundred or less, available by July 17, 2027';
    const { criteria } = localIntent(prompt, { trips: [], spans: {
      rent: [{ ...at(prompt, 'seventeen hundred'), value: 1700 }],
      availableBy: [at(prompt, 'available by July 17, 2027')],
      buildingAge: [{ ...at(prompt, '2027'), choice: 'max' }],
    } }, []);
    expect(criteria).toEqual({
      unitTypes: { value: ['studio', 'basement'], hard: true },
      rent: { value: { max: 1700 }, hard: true },
      availableBy: { value: '2027-07-17', hard: true },
    });
    expect(localIntent("Don't go over $1,550 for a condo", { trips: [], spans: {} }, []).criteria.rent?.value).toEqual({ max: 1550 });
  });

  it('keeps rent bounds and explicit preferences across alternative wording', () => {
    for (const [prompt, value, hard] of [
      ['No monthly rent over $1,325.', { max: 1325 }, true],
      ['Rent comes in at $1,845 at the most.', { max: 1845 }, true],
      ['Keep the $2,285 cap.', { max: 2285 }, true],
      ['Rent starts at $2,100 for my search.', { min: 2100 }, true],
      ["I'd rather stay under $2,650.", { max: 2650 }, false],
      ['Under $1,470, flexible.', { max: 1470 }, false],
    ] as const) {
      expect(localIntent(prompt, { trips: [], spans: {} }, []).criteria.rent).toEqual({ value, hard });
    }
    const prompt = 'Keep the rent ceiling at sixteen hundred.';
    const rent = [{ ...at(prompt, 'sixteen hundred'), value: 1600 }];
    expect(localIntent(prompt, { trips: [], spans: { rent } }, []).criteria.rent?.value).toEqual({ max: 1600 });
    for (const [discarded, amounts] of [
      ["I don't want to use the $900 cap any longer.", ['$900']],
      ['Ignore my old rent range from $1,500 to $2,200.', ['$1,500', '$2,200']],
    ] as const) {
      const spans = { rent: amounts.map(amount => at(discarded, amount)) };
      expect(localIntent(discarded, { trips: [], spans }, []).criteria.rent).toBeUndefined();
    }
    const corrected = 'Ignore the old $1,350 rent cap, but the new ceiling is $1,470.';
    expect(localIntent(corrected, { trips: [], spans: {} }, []).criteria.rent?.value).toEqual({ max: 1470 });
  });

  it.skipIf(!process.env.SEARCH_EXTRACTOR_TEST_URL)('parses a multi-stop prompt through the live local service and web API', async () => {
    const api = createRuntime({ env: { SEARCH_FIXTURES: '1', SEARCH_EXTRACTOR_URL: process.env.SEARCH_EXTRACTOR_TEST_URL } });
    try {
      const result = await api.parse(new Request('http://localhost/api/search/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Within 15 minutes biking to UW and within 20 minutes on transit to T&T, ideally 5 minutes walking to a grocery store.' }),
      }), undefined);
      expect(result.status).toBe(200);
      const parsed = await result.json();
      expect(parsed.parser).toBe('gliner');
      expect(parsed.intent.travelTargets.map((target: { maxMinutes: number; mode: string; hard: boolean }) =>
        [target.maxMinutes, target.mode, target.hard])).toEqual([[15, 'bike', true], [20, 'transit', true], [5, 'walk', false]]);
      const criteria = await api.parse(new Request('http://localhost/api/search/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Condo under twenty-five hundred dollars, two bedrooms, one and a half baths, reasonably priced, at least 650 sqft, built after 1990, central AC, cats allowed, unfurnished, no parking, in-suite laundry, utilities included, available by September 2 2027, short-term lease.' }),
      }), undefined);
      expect(criteria.status).toBe(200);
      const filters = await criteria.json();
      expect(filters.parser).toBe('gliner');
      expect(Object.keys(filters.intent.criteria)).toHaveLength(14);
      expect(filters.intent.criteria.rent.value).toEqual({ max: 2500 });
    } finally { api.jobs.dispose(); }
  }, 10_000);

  it.skipIf(!process.env.SEARCH_EXTRACTOR_TEST_URL || !process.env.POI_TEST_URL)('resolves a qualified campus building through live extraction and the POI service', async () => {
    const poi = poiClient(process.env.POI_TEST_URL)!;
    const service = new ParseService({
      extractor: searchExtractor(process.env.SEARCH_EXTRACTOR_TEST_URL),
      poiMentions: poi.mentions,
      resolver: new DestinationResolver({ poiLookup: poi.resolve }),
    });
    const prompt = "1 bed 1 bath, within 10 minutes walk of university of waterloo's E7 building. within 15 minutes transit to T&T";
    const result = await service.parse({ prompt }, 'campus-building-trip');
    expect(result.parser).toBe('gliner');
    expect(result.intent.criteria).toMatchObject({
      bedrooms: { value: { min: 1, max: 1 }, hard: true },
      bathrooms: { value: { min: 1, max: 1 }, hard: true },
    });
    expect(result.intent.travelTargets.map(target => [target.query, target.maxMinutes, target.mode, target.hard])).toEqual([
      ["university of waterloo's E7 building", 10, 'walk', true],
      ['T&T', 15, 'transit', true],
    ]);
    expect(result.destinations.map(target => target.resolution)).toMatchObject([
      { status: 'resolved', destination: { id: 'uw-building:pse' } },
      { status: 'resolved', destination: { id: 'osm:node/1654542143' } },
    ]);
    const qnc = await service.parse({ prompt: "I'm after a bike ride of ten minutes or less to QNC." }, 'spoken-trip');
    expect(qnc.intent.travelTargets).toMatchObject([{ query: 'QNC', maxMinutes: 10, mode: 'bike', hard: true }]);
    expect(qnc.destinations[0].resolution.status).toBe('resolved');
  });

  it.skipIf(!process.env.SEARCH_EXTRACTOR_TEST_URL || process.env.SEARCH_EXTRACTOR_BENCHMARK !== '1')('measures warm, uncached web parse requests', async () => {
    const prompts = {
      short: 'A condo or townhouse under $2300 near UW.',
      trips: 'Within 15 minutes biking to UW and within 20 minutes on transit to T&T, ideally 5 minutes walking to a grocery store.',
      spokenRent: 'Under twenty-five hundred dollars, two bedrooms, one and a half baths, furnished with parking, move in by September 5, twelve month lease.',
      allCriteria: 'Condo under twenty-five hundred dollars, two bedrooms, one and a half baths, reasonably priced, at least 650 sqft, built after 1990, central AC, cats allowed, unfurnished, no parking, in-suite laundry, utilities included, available by September 2 2027, short-term lease.',
    };
    for (const [name, prompt] of Object.entries(prompts)) {
      const samples: number[] = [];
      for (let iteration = 0; iteration <= 8; iteration++) {
        const api = createRuntime({ env: { SEARCH_FIXTURES: '1', SEARCH_EXTRACTOR_URL: process.env.SEARCH_EXTRACTOR_TEST_URL } });
        try {
          const started = performance.now();
          const response = await api.parse(new Request('http://localhost/api/search/parse', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
          }), undefined);
          const result = await response.json();
          const elapsed = performance.now() - started;
          expect(result.parser).toBe('gliner');
          if (iteration) samples.push(elapsed);
        } finally { api.jobs.dispose(); }
      }
      samples.sort((a, b) => a - b);
      console.log(`${name}: p50=${Math.round((samples[3] + samples[4]) / 2)} ms p95=${Math.round(samples[7])} ms n=${samples.length}`);
    }
  }, 90_000);
});
