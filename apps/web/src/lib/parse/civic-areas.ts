import { z } from 'zod';
import type { AreaFilter } from '../../../../../packages/shared/schemas/index';

export const civicAreaRow = z.object({ kind: z.literal('neighbourhood'), id: z.string().trim().min(1), name: z.string().trim().min(1), number: z.number().int().positive().nullable() });
export type CivicArea = z.infer<typeof civicAreaRow>;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function civicAreaMatches(prompt: string, catalogue: CivicArea[]) {
  const candidates = catalogue.flatMap(area =>
    [...prompt.matchAll(new RegExp(`(?<![\\w-])${escape(area.name)}(?![\\w-])`, 'gi'))].map(match => {
      const start = match.index;
      const end = start + match[0].length;
      const before = prompt.slice(0, start), after = prompt.slice(end);
      const prefix = /\b(?:(?:in|within)\s+(?:(?:the|either)\s+)*(?:neighbourhood(?:\s+of)?\s+)?|neighbourhood(?:\s+of)?\s+|limit (?:the )?(?:results|listings) to\s+|specifically want\s+)$/i.exec(before);
      const suffix = /^\s+(?:neighbourhoods?|district|addresses?|(?:dwellings|rentals|homes|listings) only|is (?:the|my) (?:area|neighbourhood|address requirement)|work as the (?:area|neighbourhood))\b/i.exec(after);
      const clause = before.split(/[,;!?\n]|\.(?=\s|$)|\bbut\b/i).at(-1) ?? '';
      const blocked = !prefix && /\b(?:near|to|not|outside)\s*(?:in\s+|the\s+)?$/i.test(before) ||
        /\b(?:used to look|formerly|previously looked|rather than|disregard)\b/i.test(clause) ||
        /\b(?:not|outside)\s+(?:in\s+)?(?:the\s+)?$/i.test(before);
      const explicit = Boolean(suffix || /neighbourhood/i.test(prefix?.[0] ?? ''));
      return { area, start, end, blocked, explicit, direct: !blocked && Boolean(prefix || suffix || prompt.trim().toLowerCase() === area.name.toLowerCase()),
        phrase: prompt.slice(prefix?.index ?? start, end + (suffix?.[0].length ?? 0)), evidence: match[0] };
    }));
  const longest = candidates.filter(match => !candidates.some(other => other.start === match.start && other.end > match.end));
  const alternatives = /^\s*(?:neighbourhoods?|district)?\s+(?:and|or)\s+(?:in\s+)?(?:the\s+)?$/i;
  const startsClause = (start: number) => /(?:^|[.!?;])\s*$/.test(prompt.slice(0, start));
  const endsClause = (end: number) => /^\s*(?:please\s*)?(?:[.!?;]|$)/i.test(prompt.slice(end));
  const direct = longest.filter(match => !match.blocked && (match.direct || startsClause(match.start) &&
    (endsClause(match.end) || longest.some(other => !other.blocked && match.end < other.start &&
      alternatives.test(prompt.slice(match.end, other.start)) && endsClause(other.end)))));
  return longest.flatMap(match => {
    if (match.blocked || !direct.includes(match) && !direct.some(other =>
      other.end < match.start && alternatives.test(prompt.slice(other.end, match.start)) ||
      match.end < other.start && alternatives.test(prompt.slice(match.end, other.start))
    )) return [];
    const ambiguous = !match.explicit && catalogue.filter(area => area.name.toLowerCase() === match.area.name.toLowerCase()).length > 1;
    return [{
      area: { kind: match.area.kind, id: match.area.id } satisfies AreaFilter,
      phrase: match.phrase, evidence: match.evidence, ambiguous, start: match.start,
    }];
  });
}
