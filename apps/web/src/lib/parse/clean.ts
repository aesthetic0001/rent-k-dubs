import { type SearchIntent } from '../../../../../packages/shared/schemas/index';
import { civicAreaMatches, type CivicArea } from './civic-areas';
import { configuredAreas } from './fallback';
import { safetyPreference } from './safety-preference';
import { isRequired } from './requirement';
export function cleanAIIntent(intent: SearchIntent, prompt: string, catalogue: CivicArea[] = []): SearchIntent {
  const source = (key: string) => { const evidence = intent.fieldSources[key]; return evidence?.source === 'ai_prompt' && !!evidence.phrase && prompt.toLowerCase().includes(evidence.phrase.toLowerCase()); };
  const required = (key: string) => {
    const phrase = intent.fieldSources[key].phrase!;
    const start = prompt.toLowerCase().indexOf(phrase.toLowerCase());
    return isRequired(prompt, start, start + phrase.length);
  };
  const drop = (field: string) => intent.droppedRequests.push({ phrase: field, reason: 'AI interpretation lacked explicit source evidence; review this filter.' });
  for (const field of Object.keys(intent.criteria) as (keyof SearchIntent['criteria'])[]) {
    const key = `criteria.${field}`;
    if (!source(key)) { delete intent.criteria[field]; drop(field); }
    else intent.criteria[field]!.hard = required(key);
  }
  intent.areas = intent.areas.filter(area => {
    const evidence = intent.fieldSources.areas?.phrase?.toLowerCase() ?? '';
    const allowed = Object.entries(configuredAreas).some(([name, configured]) => JSON.stringify(configured) === JSON.stringify(area) && new RegExp(`\\b${name}\\b`, 'i').test(evidence)) || civicAreaMatches(prompt, catalogue).some(match => !match.ambiguous && JSON.stringify(match.area) === JSON.stringify(area) && evidence.includes(match.evidence.toLowerCase()));
    if (!source('areas') || !allowed) { drop('areas'); return false; } return true;
  });
  intent.travelTargets = intent.travelTargets.filter(t => {
    delete t.resolved;
    if (t.normalizedQuery?.toLowerCase() === t.query?.toLowerCase()) delete t.normalizedQuery;
    const key = `travelTargets.${t.id}`;
    if (!source(key) || t.kind === 'place' && (!t.query || !prompt.toLowerCase().includes(t.query.toLowerCase()))) { drop(t.label); return false; }
    t.hard = required(key);
    return true;
  });
  if (intent.household) {
    for (const field of ['annualIncomeCad', 'people'] as const) if (intent.household[field] !== undefined && !source(`household.${field}`)) { delete intent.household[field]; drop(`household.${field}`); }
    if (!Object.keys(intent.household).length) delete intent.household;
  }
  // Only the renter sets a safety limit (the slider); the AI never invents one.
  delete intent.safety.maxRelativeRate;
  const safety = safetyPreference(prompt);
  if (safety) {
    intent.safety = { enabled: safety.enabled, hard: safety.hard };
    intent.fieldSources.safety = { source: 'ai_prompt', phrase: safety.phrase };
  } else if (intent.safety.enabled) { intent.safety = { enabled:false,hard:false }; drop('safety'); }
  if (intent.sortBy !== 'best_match' && !source('sortBy')) { intent.sortBy = 'best_match'; drop('sortBy'); }
  // Model-selected weights can add implicit preferences; deterministic score defaults own weights.
  delete intent.weights;
  intent.rawPrompt = prompt;
  return intent;
}
