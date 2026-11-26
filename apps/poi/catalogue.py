"""PostgreSQL-backed catalogue and hybrid ranking from the Waterloo prototype."""

import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import numpy as np

from fuzzy import GENERIC_NAMES, boosts, build_fields

MODEL = "BAAI/bge-base-en-v1.5"
REVISION = "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a"
INSTRUCTION = "Represent this sentence for searching relevant passages: "
ROAD_WORDS = dict(rd="road", st="street", ave="avenue", blvd="boulevard",
                  dr="drive", n="north", s="south", e="east", w="west")
STREET_TYPES = {"road", "street", "avenue", "boulevard", "drive", "lane", "court", "way"}
IGNORED_WORDS = {"a", "the", "at", "on", "of", "in", "by", "near", "closest"}
TOKEN = re.compile(r"[^\W_]+(?:['’][^\W_]+)*|&", re.UNICODE)
CUE = re.compile(r"\b(?:near|nearby|close to|around|by|to|from|of|at|in)\s+(?:the\s+)?$", re.I)
GENERIC_ALIASES = {(word,) for word in GENERIC_NAMES - {"uw", "uwaterloo"}}

# Aliases reference the existing POI ID, so the database remains the source for its point.
POI_ALIASES = {"osm:node/1654542143": ["T&T", "T&T Supermarket", "T and T"]}


def words(value):
    value = unicodedata.normalize("NFKD", value.casefold().replace("’", "'"))
    value = "".join(char for char in value if not unicodedata.combining(char))
    return [ROAD_WORDS.get(word, word) for word in re.findall(r"\w+", value.replace("'", ""))]


def alias_key(value):
    return tuple(words(value.replace("&", " and ")))


def postgres_places(dsn):
    from psycopg import connect
    from psycopg.rows import dict_row

    with connect(dsn, connect_timeout=10, row_factory=dict_row) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        conn.execute("SET LOCAL statement_timeout = '10s'")
        return conn.execute("""
            SELECT id, name, category, coalesce(subcategory, '') AS subcategory,
                   coalesce(to_jsonb(p)->>'street_name', '') AS street,
                   coalesce(to_jsonb(p)->>'house_number', '') AS house_number,
                   coalesce(to_jsonb(p)->>'city', '') AS city,
                   coalesce(to_jsonb(p)->'aliases', '[]'::jsonb) AS aliases,
                   ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
            FROM pois AS p ORDER BY id
        """).fetchall()


def load_places(dsn, known_dir):
    places = {
        row["id"]: {**row, "aliases": list(dict.fromkeys([*row["aliases"], *POI_ALIASES.get(row["id"], [])]))}
        for row in postgres_places(dsn)
    }
    for filename in ("known_places.json", "known_places.generated.json"):
        for row in json.loads((Path(known_dir) / filename).read_text()):
            places[row["id"]] = {
                **row, "name": row["label"], "street": "", "house_number": "", "city": "",
                "category": "campus building" if row["id"].startswith("uw-building:") else "",
                "subcategory": "",
            }
    return list(places.values())


def document(poi):
    address = " ".join(part for part in (poi["house_number"], poi["street"]) if part)
    fields = [poi["name"], *poi["aliases"], poi["category"], poi["subcategory"], address, poi["city"]]
    return " | ".join(dict.fromkeys(field.replace("_", " ") for field in fields if field))


class BgeEncoder:
    def __init__(self):
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.torch = torch
        torch.set_num_threads(4)
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION)
        self.model = AutoModel.from_pretrained(MODEL, revision=REVISION).eval()

    def __call__(self, texts):
        vectors = []
        with self.torch.inference_mode():
            for offset in range(0, len(texts), 32):
                inputs = self.tokenizer(texts[offset:offset + 32], padding=True, truncation=True,
                                        max_length=96, return_tensors="pt")
                hidden = self.model(**inputs).last_hidden_state[:, 0]
                vectors.append(self.torch.nn.functional.normalize(hidden, dim=1).numpy())
        return np.concatenate(vectors)


def distance(a, b):
    lat = (a["lat"] + b["lat"]) / 2
    return 111_320 * math.hypot(a["lat"] - b["lat"],
                                (a["lng"] - b["lng"]) * math.cos(math.radians(lat)))


def utf16(text):
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def choice(poi):
    address = " ".join(filter(None, (poi["house_number"], poi["street"])))
    label = f'{poi["name"]} ({address})' if address else poi["name"]
    return {"id": poi["id"], "label": label, "resolved": {
        "lat": poi["lat"], "lng": poi["lng"], "source": "known_place",
        "representativePoint": True, "label": label,
    }}


def street_matches(poi, qualifier):
    street = set(words(poi["street"])) - STREET_TYPES - IGNORED_WORDS
    requested = set(words(qualifier)) - STREET_TYPES - IGNORED_WORDS
    known = street | set(words(poi["house_number"])) | set(words(poi["city"]))
    return bool(requested & street) and requested <= known


class Catalogue:
    def __init__(self, places, encode):
        self.places = places
        self.encode = encode
        self.aliases = defaultdict(list)
        for i, poi in enumerate(places):
            for key in dict.fromkeys(alias_key(name) for name in [poi["name"], *poi["aliases"]]):
                if not key or key in GENERIC_ALIASES:
                    continue
                self.aliases[key].append(i)
        self.max_tokens = max(map(len, self.aliases), default=0)
        # Intersections retain exact lookup. Their repeated street names add noise to semantic ranking.
        self.rankable = [p for p in places if not p["id"].startswith("waterloo-intersection:")]
        self.fields = build_fields(self.rankable, words, STREET_TYPES, IGNORED_WORDS)
        self.vectors = encode([document(p) for p in self.rankable]) if self.rankable else None

    def mentions(self, prompt):
        tokens = list(TOKEN.finditer(prompt))
        found = []
        i = 0
        while i < len(tokens) and len(found) < 128:
            start = tokens[i].start()
            before = prompt[:start].rstrip('\"“‘(')
            previous = found[-1][1] if found else 0
            if before.strip() and not CUE.search(before) and not (
                found and re.fullmatch(r"\s*(?:and|or|,)\s*(?:the\s+)?", prompt[previous:start], re.I)
            ):
                i += 1
                continue
            for j in range(min(len(tokens), i + self.max_tokens), i, -1):
                end = tokens[j - 1].end()
                phrase = prompt[start:end]
                if re.search(r"[,;!?\n]", phrase) or alias_key(phrase) not in self.aliases:
                    continue
                if j + 1 < len(tokens) and tokens[j].group().lower() == "on":
                    owners = [self.places[k] for k in self.aliases[alias_key(phrase)]]
                    for k in range(min(len(tokens), j + 8), j + 1, -1):
                        street = prompt[tokens[j + 1].start():tokens[k - 1].end()]
                        if not re.search(r"[,;!?\n]", street) and any(street_matches(p, street) for p in owners):
                            j, end = k, tokens[k - 1].end()
                            break
                found.append((start, end))
                i = j
                break
            else:
                i += 1
        return [{"text": prompt[a:b], "start": utf16(prompt[:a]), "end": utf16(prompt[:b])} for a, b in found]

    def distinct(self, places):
        result = []
        for place in places:
            if not any(alias_key(place["name"]) == alias_key(other["name"])
                       and not place["id"].startswith("uw-building:")
                       and not other["id"].startswith("uw-building:")
                       and distance(place, other) <= 100 for other in result):
                result.append(place)
        return result

    def resolve(self, query, prefer_primary=True, near=None):
        exact = self.distinct([self.places[i] for i in self.aliases.get(alias_key(query), [])])
        if near:
            exact.sort(key=lambda p: distance(near, p))
        primary = [p for p in exact if p.get("primary")]
        if prefer_primary and len(primary) == 1:
            exact = primary
        if exact:
            choices = [choice(p) for p in exact[:5]]
            return ({"status": "resolved", "query": query, "destination": choices[0]} if len(choices) == 1 else
                    {"status": "ambiguous", "query": query, "choices": choices})

        qualified = re.fullmatch(r"(.+?)\s+on\s+(.+)", query, re.I)
        if qualified:
            name, street = qualified.groups()
            owners = [self.places[i] for i in self.aliases.get(alias_key(name), [])]
            if owners:
                matches = self.distinct([p for p in owners if street_matches(p, street)])
                if len(matches) == 1:
                    return {"status": "resolved", "query": query, "destination": choice(matches[0])}
                choices = [choice(p) for p in (matches or self.distinct([p for p in owners if not p["street"]]))[:5]]
                if choices:
                    return {"status": "ambiguous", "query": query, "choices": choices}
                return {"status": "unavailable", "query": query, "reason": "No catalogue match on that street."}

        if self.vectors is None:
            return {"status": "unavailable", "query": query, "reason": "No catalogue match."}
        scores = self.vectors @ self.encode([INSTRUCTION + query])[0]
        agreement = boosts(query, self.fields, words, STREET_TYPES, IGNORED_WORDS)
        top = np.argsort(-scores, kind="stable")[:12]
        ranked = sorted(top, key=lambda i: -(scores[i] + max(0, scores[i]) * agreement.get(i, 0)))
        # shortcut: the benchmark had known answers; require confirmation for hybrid suggestions
        # until negative and branch-ambiguity cases calibrate automatic acceptance.
        candidates = [self.rankable[i] for i in ranked
                      if (scores[i] >= 0.65 and agreement.get(i, 0) > 0) or scores[i] >= 0.82]
        choices = [choice(p) for p in self.distinct(candidates)[:3]]
        if choices:
            return {"status": "ambiguous", "query": query, "choices": choices}
        return {"status": "unavailable", "query": query, "reason": "No confident catalogue match."}
