"""Fuzzy evidence from the full phrase, grouped by normalized field value."""

from collections import defaultdict
from difflib import SequenceMatcher

DIRECTIONS = {"north", "south", "east", "west"}
GENERIC_NAMES = {
    "building", "campus", "centre", "center", "clinic", "college", "grocery",
    "library", "market", "park", "pharmacy", "public", "school", "station",
    "university", "uw", "uwaterloo", "waterloo",
}


def build_fields(pois, words, road_types, ignored):
    name_index = defaultdict(dict)
    street_index = defaultdict(dict)
    for i, poi in enumerate(pois):
        for name in [poi["name"], *poi["aliases"]]:
            tokens = tuple(word for word in words(name) if word not in ignored)
            for start in range(len(tokens)):
                for end in range(start + 1, len(tokens) + 1):
                    phrase = tokens[start:end]
                    if len(phrase) == 1 and phrase != tokens and (
                        phrase[0] in GENERIC_NAMES or phrase[0].isnumeric()
                    ):
                        continue
                    strength = 0.55 + 0.45 * len(phrase) / len(tokens)
                    name_index[phrase][i] = max(name_index[phrase].get(i, 0), strength)

        street = tuple(word for word in words(poi["street"]) if word not in road_types)
        if street[:1] == ("the",):
            street = street[1:]
        if not street:
            continue
        direction = street[-1] if street[-1] in DIRECTIONS else ""
        core = street[:-1] if direction else street
        number = next(iter(words(poi["house_number"])), "")
        street_index[core][i, direction, number] = 1.0
    return name_index, street_index


def matches(query, field_index, minimum, street=False):
    windows = {
        length: [(i, query[i:i + length]) for i in range(len(query) - length + 1)]
        for length in set(map(len, field_index))
        if length <= len(query)
    }
    candidates = []
    for field, owners in field_index.items():
        best = {}
        for start, phrase in windows.get(len(field), ()):
            if phrase == field:
                quality = 1.0
            else:
                if any((a.isdigit() or b.isdigit() or min(len(a), len(b)) < 4)
                       and a != b for a, b in zip(field, phrase)):
                    continue
                left, right = " ".join(field), " ".join(phrase)
                similarity = SequenceMatcher(None, left, right, autojunk=False)
                if similarity.real_quick_ratio() < minimum or similarity.quick_ratio() < minimum:
                    continue
                quality = similarity.ratio()
                if quality < minimum:
                    continue
            if street:
                after = query[start + len(field):start + len(field) + 1]
                before = query[max(0, start - 2):start]
                direction = after[0] if after and after[0] in DIRECTIONS else (
                    before[-1] if before and before[-1] in DIRECTIONS else ""
                )
                adjacent = before[-2:] if before and before[-1] in DIRECTIONS else before[-1:]
                number = next((word for word in adjacent if word.isdigit()), "")
                for (i, stored_direction, stored_number), strength in owners.items():
                    if direction and direction != stored_direction:
                        continue
                    if number and number != stored_number:
                        continue
                    evidence = quality * strength * (1.0 if number or direction else 0.9)
                    best[i] = max(best.get(i, 0), evidence)
            else:
                if len(field) == 1 and field[0] in GENERIC_NAMES and field != query:
                    continue
                for i, strength in owners.items():
                    best[i] = max(best.get(i, 0), quality * strength)
        if best:
            candidates.append((max(best.values()), len(field), field, best))

    hits = {}
    # Keep three distinct field values. Branches with the same name share a match.
    top = sorted(candidates, key=lambda candidate: candidate[:3], reverse=True)[:3]
    for _, _, _, evidence in top:
        for i, strength in evidence.items():
            hits[i] = max(hits.get(i, 0), strength)
    return hits


def boosts(query, fields, words, road_types, ignored):
    tokens = words(query)
    name = matches(tuple(word for word in tokens if word not in ignored), fields[0], 0.82)
    street = matches(tuple(word for word in tokens if word not in road_types), fields[1], 0.90,
                     street=True)
    return {
        i: 0.085 * name.get(i, 0) + 0.045 * street.get(i, 0)
        + 0.055 * name.get(i, 0) * street.get(i, 0)
        for i in name.keys() | street.keys()
    }
