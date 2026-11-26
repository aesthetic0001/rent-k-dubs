import { historicalConstraint } from './quantities';

const fields = {
  furnished: /\b(?:unfurnished|furnished|furnishings?|bring (?:my|our) own furniture|furnish(?:ing)? it (?:myself|ourselves))\b/gi,
  parking: /\b(?:parking(?: (?:space|spot|stall|place))?|(?:driveway|garage) (?:space|spot|stall)|(?:spot|space|stall) for (?:my|the|a) car)\b/gi,
  laundryInSuite: /\b(?:in[- ](?:suite|unit|apartment) laundry|laundry inside|washer[- ]dryer (?:pair )?(?:is )?part of (?:the )?(?:unit|suite)|(?:laundry(?: machines?)?|wash(?:er|ing machine)(?:(?: and| or) dryer)?)\s+(?:inside|in)\s+(?:(?:the|my|this) )?(?:own )?(?:unit|suite|apartment|place|itself)|(?:private|own) laundry)\b/gi,
  utilitiesIncluded: /\b(?:utilit(?:y|ies) (?:not )?(?:included|bundled|covered)|(?:including|include|covered|bundled|all-inclusive) utilit(?:y|ies)|(?:all )?utilities in the rent|without utilities|(?:pay )?utilities separately|(?:utility bills|bills) bundled into (?:the )?rent|utility bills on top|(?:pay )?(?:heat|hydro|electricity|electric|water|utilities)(?: and (?:water|heat|hydro))?(?:(?: (?:billed|charged))? outside (?:the )?rent|(?: already)? in the rent)|utilities (?:should be |are )?billed separately)\b/gi,
};

export type ListingFeature = keyof typeof fields;

export function listingFeature(prompt: string, field: ListingFeature) {
  const matches = [...prompt.matchAll(fields[field])];
  for (const match of matches) {
    const start = match.index, end = start + match[0].length;
    const prefix = prompt.slice(Math.max(0, start - 70), start);
    const suffix = prompt.slice(end);
    const nearby = prefix.split(/[;!?\n]|\.(?=\s|$)|(?<!\d),|,(?!\d)|\b(?:and|but)\b/i).at(-1) ?? '';
    const ignored = historicalConstraint(prompt, start, end) ||
      /\b(?:(?:fine|okay|ok|happy) without|could live without)\s*$/i.test(nearby) ||
      /\bno need for\s+(?:(?:a|an|the|any|reserved)\s+)*$/i.test(nearby) ||
      /\b(?:don['’]t mind|doesn['’]t matter) whether\b/i.test(nearby) ||
      field === 'parking' && /\b(?:already )?have (?:my|our) own\s*$/i.test(nearby) ||
      /\b(?:no|without a) filter (?:for|on)\s*$/i.test(nearby) ||
      /\bno\s*$/i.test(nearby) && /^\s*(?:needed|required|requirement)\b/i.test(suffix) ||
      /\bnot whether\b|\$\d[\d,.]*\s+in\s*$/i.test(nearby) ||
      /^\s*(?:isn['’]t (?:needed|required|a criterion)|doesn['’]t matter|(?:is )?not (?:a criterion|required|needed)|(?:does not|doesn['’]t) have to be included)\b/i.test(suffix);
    if (ignored) continue;
    if (field === 'furnished' && /^furnishings?$/i.test(match[0]) &&
      !/^\s+(?:(?:is|are)\s+)?(?:optional|required|preferred)\b/i.test(suffix)) continue;
    const negative = /\b(?:no|without|exclude|don['’]t (?:want|include))\s+(?:(?:on[- ]site|off[- ]street|included|any)\s+)?$/i.exec(nearby) ??
      (/^includ(?:e|ing)\b/i.test(match[0]) ? /\b(?:don['’]t|do not)\s+$/i.exec(nearby) : null);
    const phrase = prompt.slice(start - (negative?.[0].length ?? 0), end);
    return { value: !negative && !/\b(?:unfurnished|bring (?:my|our) own|furnish(?:ing)? it|not|without|separately|outside|on top)\b/i.test(match[0]), phrase };
  }
  return matches.length ? { value: null, phrase: '' } : undefined;
}
