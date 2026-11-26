const clauseBreak = /[;!?\n]|(?<!\d),|,(?!\d)|\.(?=\s|$)|\b(?:and|but)\b/gi;
const preference = /\b(?:prefer(?:red|ably)?|ideally|ideal(?=\s+budget\b)|(?:i|we)(?:['’]d| would) rather|optional(?:ly)?|nice[- ]to[- ]have|would be (?:nice|great|a plus|ideal)|would love|would happily compromise|if possible)\b/gi;
const approximation = /\b(?:around|about|roughly|approximately)\s+(?=\$?\s*(?:\d|half\b|(?:a\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b))/gi;
const requirement = /\b(?:must(?: have| be)?|required|need(?:s|ed)?|non[- ]negotiable)\b/gi;

export function isRequired(prompt: string, start: number, end: number): boolean {
  const before = prompt.slice(0, start);
  const prefix = before.split(clauseBreak).at(-1) ?? '';
  const evidence = prefix + prompt.slice(start, end);
  const suffix = prompt.slice(end);
  if (/^\s*,?\s*(?:(?:unit|place|listing|rental|landlord|nearby)\s+)?(?:(?:(?:is|can be)\s+)?(?:optional|preferred)|(?:is an? )?nice[- ]to[- ]have|is (?:ideal|just a bonus)|would (?:be (?:nice|great|helpful|useful|a plus|a bonus|preferable|(?:my )?ideal)|help)|that['’]s a plus|(?:only )?if (?:(?:that['’]s )?possible|feasible|it['’]s available|i can get it))\b/i.test(suffix)) return false;
  if (/^\s*;\s*it['’]d be nice\b/i.test(suffix)) return false;
  if (/^\s*,\s*(?:ideally|flexible)(?=\s*(?:[.!?;\n]|$))/i.test(suffix)) return false;
  const required = [...evidence.matchAll(requirement)].at(-1)?.index ?? -1;
  const preferred = Math.max(
    [...evidence.matchAll(preference)].at(-1)?.index ?? -1,
    [...evidence.matchAll(approximation)].at(-1)?.index ?? -1,
    [...evidence.matchAll(/\b(?:best if|best case|could compromise)\b/gi)].at(-1)?.index ?? -1,
    /(?:^|[;.!?\n])\s*(?:if possible|ideally|preferably)\s*,\s*$/i.test(before) ? 0 : -1,
    /(?:^|[;.!?\n])\s*would be (?:nice|great) to have [^;.!?]+\band\s*$/i.test(before) ? 0 : -1,
  );
  return preferred === -1 || required > preferred;
}
