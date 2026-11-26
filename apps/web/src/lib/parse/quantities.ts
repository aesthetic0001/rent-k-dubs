export const decimal = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const words = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const wordValues = new Map(words.map((word, index) => [word, index]));
const tens = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
for (const [index, word] of tens.entries()) {
  wordValues.set(word, (index + 2) * 10);
  for (const [offset, unit] of words.slice(1, 10).entries()) wordValues.set(`${word} ${unit}`, (index + 2) * 10 + offset + 1);
}
const countedWord = `(?:${tens.join('|')})(?:[- ](?:${words.slice(1, 10).join('|')}))?|(?:${words.join('|')}|single|second|half)`;
const count = `(?:${decimal}|${countedWord})(?: and (?:a )?half|[- ]and[- ]a[- ]half)?`;
const lowerBound = 'at least|(?:no|nothing) (?:less|fewer) than|minimum(?: floor area)?(?: of)?|over|more than';
const upperBound = 'at most|no (?:more|larger) than|maximum(?: floor area)?(?: of)?|up to|under|below|less than';
const isLower = new RegExp(`^(?:${lowerBound})$`, 'i');

export function quantity(text: string): number | undefined {
  const number = new RegExp(decimal).exec(text);
  if (number) return Number(number[0].replaceAll(',', '')) * (/^\s*k\b/i.test(text.slice(number.index + number[0].length)) ? 1000 : 1);
  const tokens = text.toLowerCase().replaceAll('-', ' ').trim().split(/\s+/);
  const start = tokens.findIndex(word => wordValues.has(word) || /^(?:half|single|second)$/.test(word));
  if (start < 0) return undefined;
  const special = { half: 0.5, single: 1, second: 2 } as const;
  const first = tokens[start];
  if (first in special) return special[first as keyof typeof special];
  const pair = wordValues.get(tokens.slice(start, start + 2).join(' '));
  return (pair ?? wordValues.get(first)!) + (tokens.slice(start + (pair === undefined ? 1 : 2)).join(' ').startsWith('and a half') ? 0.5 : 0);
}

export function historicalConstraint(prompt: string, start: number, end: number) {
  const before = prompt.slice(0, start).split(/[;!?\n]|\.(?=\s|$)|(?<!\d),|,(?!\d)|\bbut\b|\band\s+(?:(?:i|we)\s+)?(?=want|need|require|keep|set|show)/i).at(-1) ?? '';
  const after = prompt.slice(end);
  return /\b(?:my (?:old|current|previous) (?:place|unit|home|apartment|listing|rental|search) (?:was|had|has|is|wanted|used)|(?:the|my|our) (?:last|previous) (?:place|rental|home)\b[^.;!?]*\b(?:was|had)\b|the ad says|(?:months?|years?) ago|i currently rent|never mind|skip the old|not looking for|not a building|ignore|disregard|forget|take out|remove the filter|stop filtering|don['’]t (?:use|inherit|infer|care|filter))\b/i.test(before) ||
    /\bnot the\s*$/i.test(before) && /^\s*(?:minimum|maximum|range)?\s*from (?:my|the|our) (?:earlier|old|previous) search\b/i.test(after) ||
    /^\s*[,;]\s*don['’]t use (?:that|the) (?:number|size|amount)\b/i.test(after) ||
    /^[-\s]+(?:unit\s+)?(?:restriction|filter)\b[^.;!?]*\b(?:is gone|was removed|no longer applies)\b/i.test(after);
}

export function explicitMeasure(prompt: string, field: 'bedrooms' | 'bathrooms' | 'sizeSqft') {
  const input = field === 'sizeSqft' ? decimal : count;
  const noun = field === 'sizeSqft' ? 'sq\\.?\\s*ft|square (?:feet|foot)|sqft' :
    field === 'bedrooms' ? 'bedrooms?|beds?|rooms?' : 'bathrooms?|baths?';
  const start = '(?<![\\w$.,])';
  const unit = `\\s*-?\\s*(?:full\\s+)?(?:${noun})\\b`;
  const range = [...prompt.matchAll(new RegExp(`${start}(?:(between|from|either|${lowerBound})\\s+)?(${input})\\s*(to|through|-\\s+to|[-–—]|and|or)\\s*(?:(${upperBound})\\s+)?(${input})${unit}`, 'gi'))]
    .find(m => (!/^and$/i.test(m[3]) || /^between$/i.test(m[1] ?? '') || Boolean(m[1] && m[4])) &&
      !historicalConstraint(prompt, m.index, m.index + m[0].length));
  if (range) return { phrase: range[0], start: range.index, value: { min: quantity(range[2])!, max: quantity(range[5])! } };
  const single = [...prompt.matchAll(new RegExp(`${start}(?:(${lowerBound}|${upperBound}|max|min|exactly)\\s+)?(${input}${field === 'sizeSqft' ? '' : '|a'})(\\+)?${unit}(?:\\s+(or (?:more|less|higher|lower)|minimum|maximum)\\b)?`, 'gi'))]
    .find(m => !(field === 'bedrooms' && (/^a$/i.test(m[2]) && !m[1] ||
        /\bshared\b/i.test(prompt.slice(m.index + m[0].length, m.index + m[0].length + 25)) && /\brooms?\b/i.test(m[0]))) &&
        !historicalConstraint(prompt, m.index, m.index + m[0].length));
  if (!single) return;
  const value = /^a$/i.test(single[2]) ? 1 : quantity(single[2]);
  if (value === undefined) return;
  const min = Boolean(single[3] || /more|higher|minimum/i.test(single[4] ?? '') || isLower.test(single[1] ?? '') || /^min$/i.test(single[1] ?? ''));
  const max = !min && (Boolean(single[1] && !/^exactly$/i.test(single[1])) || /less|lower|maximum/i.test(single[4] ?? ''));
  return { phrase: single[0], start: single.index, value: min ? { min: value } : max ? { max: value } : { min: value, max: value } };
}
