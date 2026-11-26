const word = String.raw`(?!(?:and|or|near|around|at|to|of|from|by|within|under|over|with|without|in|for)\b)[\p{L}][\p{L}'’.-]*`;
const pattern = new RegExp(String.raw`(?:\b(?:near|around|at|to|of|from|by|and)\s+|^)(${word}(?:\s+${word}){0,4}\s+(?:park(?:\s+(?:east|west|north|south|station|library|zoo))?|conservation area)(?:\s+in\s+(?:Kitchener|Waterloo|Cambridge))?)(?![\p{L}'’-])`, 'giu');
const generic = /^(?:(?:a|an|any|some|nearest|nearby|local|public|large|big|small|nice|good|quiet|green|dog|dog-friendly|off-leash|walking|walkable|city|urban|national|playground|named)\s+)*(?:park|conservation area)$/i;

export function namedParkMentions(prompt: string): { phrase: string; index: number }[] {
  // shortcut: recognize short names ending in Park, including directional/facility qualifiers; other names need AI parsing.
  return [...prompt.matchAll(pattern)].flatMap(match => {
    const phrase = match[1].replace(/^(?:(?:the|both|ideally|must have|(?:i|we) (?:only )?(?:need|want)|pick)\s+)+/i, '');
    return generic.test(phrase) ? [] : [{ phrase, index: match.index + match[0].lastIndexOf(phrase) }];
  });
}
