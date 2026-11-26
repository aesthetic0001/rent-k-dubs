"""Offline retrieval experiment for already extracted destination phrases."""

import argparse
import json
import re
import time
import unicodedata
from pathlib import Path

import numpy as np
import torch
from huggingface_hub import hf_hub_download
from transformers import AutoModel, AutoTokenizer

from fuzzy import boosts, build_fields

ROOT = Path(__file__).resolve().parents[2]
MODELS = {
    "BAAI/bge-small-en-v1.5": "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
    "BAAI/bge-base-en-v1.5": "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a",
    "intfloat/e5-small-v2": "ffb93f3bd4047442299a41ebb6fa998a38507c52",
}
INSTRUCTION = "Represent this sentence for searching relevant passages: "
ROAD_WORDS = dict(rd="road", st="street", ave="avenue", blvd="boulevard",
                  dr="drive", n="north", s="south", e="east", w="west")
STREET_TYPES = {"road", "street", "avenue", "boulevard", "drive", "lane", "court", "way"}
IGNORED_WORDS = {"a", "the", "at", "on", "of", "in", "by", "near", "closest"}


def words(value):
    value = unicodedata.normalize("NFKD", value.casefold().replace("’", "'"))
    value = "".join(char for char in value if not unicodedata.combining(char))
    return [ROAD_WORDS.get(word, word) for word in re.findall(r"\w+", value.replace("'", ""))]


def names(poi):
    return {tuple(words(name)) for name in [poi["name"], *poi["aliases"]]}


def load_pois(path):
    rows = json.loads(path.read_text())
    parse_dir = ROOT / "apps/web/src/lib/parse"
    for path in [parse_dir / "known_places.json", parse_dir / "known_places.generated.json"]:
        for place in json.loads(path.read_text()):
            if place["label"].endswith(" intersection"):
                continue
            if not (43.40 <= place["lat"] <= 43.56 and -80.67 <= place["lng"] <= -80.42):
                continue
            category = "campus building" if place["id"].startswith("uw-building:") else ""
            rows.append({**place, "name": place["label"], "category": category,
                         "subcategory": "", "street": "", "house_number": "",
                         "city": "", "aliases": place["aliases"]})
    return rows


def document(poi, address=True):
    fields = [poi["name"], *poi["aliases"], poi["category"], poi["subcategory"]]
    if address:
        fields += [" ".join(filter(None, [poi["house_number"], poi["street"]])), poi["city"]]
    return " | ".join(dict.fromkeys(field.replace("_", " ") for field in fields if field))


def lexical_scores(documents, queries):
    terms = sorted({word for doc in documents for word in words(doc)} - IGNORED_WORDS)
    lookup = {word: index for index, word in enumerate(terms)}

    def vectors(texts):
        matrix = np.zeros((len(texts), len(terms)), dtype=np.float32)
        for index, text in enumerate(texts):
            for word in set(words(text)) & lookup.keys():
                matrix[index, lookup[word]] = 1
        return matrix

    docs = vectors(documents)
    idf = 1 + np.log((len(documents) + 1) / (1 + docs.sum(axis=0)))

    def unit(matrix):
        weighted = matrix * idf
        return weighted / np.maximum(np.linalg.norm(weighted, axis=1, keepdims=True), 1)

    return unit(vectors(queries)) @ unit(docs).T


def encode(model, tokenizer, texts, mean_pool=False):
    embeddings = []
    with torch.inference_mode():
        for offset in range(0, len(texts), 32):
            inputs = tokenizer(texts[offset:offset + 32], padding=True, truncation=True,
                               max_length=96, return_tensors="pt")
            hidden = model(**inputs).last_hidden_state
            if mean_pool:
                mask = inputs.attention_mask[..., None]
                vectors = (hidden * mask).sum(dim=1) / mask.sum(dim=1)
            else:
                vectors = hidden[:, 0]
            embeddings.append(torch.nn.functional.normalize(vectors, dim=1).numpy())
    return np.concatenate(embeddings)


def guarded_scores(pois, query, scores):
    """Shortcut: handle an explicit 'on STREET' suffix for the prototype."""
    scores = scores.copy()
    name, separator, qualifier = query.casefold().partition(" on ")
    if separator:
        street = set(words(qualifier)) - STREET_TYPES - IGNORED_WORDS
        matches = [i for i, poi in enumerate(pois) if street and street <= set(words(poi["street"]))]
        exact = [i for i in matches if tuple(words(name)) in names(pois[i])]
        allowed = exact or matches
        denied = np.ones(len(pois), dtype=bool)
        denied[allowed] = False
        scores[denied] = -np.inf
    else:
        phrase = tuple(word for word in words(query) if word not in IGNORED_WORDS)
        exact = [poi for poi in pois if phrase in names(poi)]
        if len(exact) > 1 and np.ptp([float(poi["lat"]) for poi in exact]) + np.ptp(
            [float(poi["lng"]) for poi in exact]
        ) > 0.004:
            scores[:] = -np.inf
    return scores


def hybrid_scores(scores, agreement):
    boosted = scores.copy()
    for i in np.argsort(-scores, kind="stable")[:12]:
        boosted[i] += max(0, scores[i]) * agreement.get(i, 0)
    return boosted


def ranked(pois, scores, original=None):
    result = []
    for i in np.argsort(-scores, kind="stable"):
        if not np.isfinite(scores[i]):
            break
        poi = pois[i]
        result.append({"id": poi["id"], "name": poi["name"], "street": poi["street"],
                       "score": round(float(scores[i]), 5)})
        if original is not None:
            result[-1]["agreement_boost"] = round(float(scores[i] - original[i]), 5)
        if len(result) == 3:
            break
    return result


def measure(cases, threshold, margin):
    counts = dict(positive=0, top1=0, top3=0, accepted_correct=0, accepted_wrong=0,
                  rejected_correct=0, rejected_positive=0)
    decisions = []
    for case in cases:
        expected, ranked = case["expected"], case["top"]
        found = bool(ranked) and ranked[0]["id"] in expected
        accepted = bool(ranked) and ranked[0]["score"] >= threshold and (
            len(ranked) == 1 or round(ranked[0]["score"] - ranked[1]["score"], 5) >= margin
        )
        counts["positive"] += bool(expected)
        counts["top1"] += found
        counts["top3"] += any(candidate["id"] in expected for candidate in ranked)
        outcome = ("accepted_correct" if found else "accepted_wrong") if accepted else (
            "rejected_positive" if expected else "rejected_correct"
        )
        counts[outcome] += 1
        decisions.append({**case, "outcome": outcome})
    return counts, decisions


def calibrate(cases):
    scores = {case["top"][0]["score"] for case in cases if case["top"]}
    thresholds = sorted({-1.0, max(scores, default=1) + 0.00001, *scores})
    margins = sorted({0.0, *(
        round(case["top"][0]["score"] - case["top"][1]["score"] + 0.00001, 5)
        for case in cases if len(case["top"]) > 1
    )})

    def utility(pair):
        result, _ = measure(cases, *pair)
        return (-result["accepted_wrong"], result["accepted_correct"], -pair[0], -pair[1])

    return max(((threshold, margin) for threshold in thresholds for margin in margins), key=utility)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("--cases", type=Path, default=Path(__file__).with_name("cases.json"))
    parser.add_argument("--model", choices=MODELS, default="BAAI/bge-small-en-v1.5")
    parser.add_argument("--allowed-ids", type=Path, help="Limit the index to these POI IDs")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--query", help="Also print the ranked candidates for one phrase")
    args = parser.parse_args()
    fixtures = json.loads(args.cases.read_text())
    examples = fixtures["development"] + fixtures["holdout"]
    queries = [query for query, _ in examples] + ([args.query] if args.query else [])
    pois = load_pois(args.corpus)
    if args.allowed_ids:
        allowed = set(json.loads(args.allowed_ids.read_text()))
        pois = [poi for poi in pois if poi["id"] in allowed]
    assert {poi_id for _, ids in examples for poi_id in ids} <= {poi["id"] for poi in pois}
    torch.set_num_threads(4)
    revision = MODELS[args.model]
    snapshot = Path(hf_hub_download(
        args.model, "config.json", revision=revision, local_files_only=True,
    )).parent
    tokenizer = AutoTokenizer.from_pretrained(snapshot, local_files_only=True)
    model = AutoModel.from_pretrained(snapshot, local_files_only=True).eval()
    e5 = args.model.startswith("intfloat/")
    query_prefix, doc_prefix = ("query: ", "passage: ") if e5 else (INSTRUCTION, "")
    dense_method = "e5" if e5 else "bge"

    def embed(texts, prefix):
        return encode(model, tokenizer, [prefix + text for text in texts], mean_pool=e5)

    docs = [document(poi) for poi in pois]
    started = time.perf_counter()
    vectors = embed(docs, doc_prefix)
    seconds = time.perf_counter() - started
    query_vectors = embed(queries, query_prefix)
    query_ms = []
    hybrid_ms = []
    agreements = []
    fields = build_fields(pois, words, STREET_TYPES, IGNORED_WORDS)
    for query in queries:
        started = time.perf_counter()
        agreement = boosts(query, fields, words, STREET_TYPES, IGNORED_WORDS)
        agreements.append(agreement)
        fuzzy_finished = time.perf_counter()
        query_vector = embed([query], query_prefix)[0]
        scores = np.sum(vectors * query_vector, axis=1)
        scored_at = time.perf_counter()
        ranked(pois, scores)
        ranked_at = time.perf_counter()
        query_ms.append(1000 * (ranked_at - fuzzy_finished))
        ranked(pois, hybrid_scores(scores, agreement), scores)
        hybrid_ms.append(1000 * (scored_at - started + time.perf_counter() - ranked_at))
    dense = query_vectors @ vectors.T
    hybrid_method = f"{dense_method}_fuzzy_boost"
    methods = {
        "lexical": lexical_scores(docs, queries),
        f"{dense_method}_no_address": query_vectors @ embed(
            [document(poi, False) for poi in pois], doc_prefix).T,
        dense_method: dense,
        hybrid_method: [hybrid_scores(scores, agreement)
                        for scores, agreement in zip(dense, agreements, strict=True)],
        f"{dense_method}_street_guard": [guarded_scores(pois, query, scores)
                                         for query, scores in zip(queries, dense, strict=True)],
    }
    results = {"model": args.model, "revision": revision, "documents": len(pois),
               "documents_with_street": sum(bool(poi["street"]) for poi in pois),
               "index_encoding_seconds": round(seconds, 3),
               "warm_query_ms": {"median": round(float(np.median(query_ms)), 1),
                                 "p95": round(float(np.percentile(query_ms, 95)), 1)},
               "warm_hybrid_query_ms": {"median": round(float(np.median(hybrid_ms)), 1),
                                        "p95": round(float(np.percentile(hybrid_ms, 95)), 1)},
               "methods": {}}
    for name, scores in methods.items():
        origins = dense if name == hybrid_method else [None] * len(scores)
        rankings = [{"query": query, "expected": expected,
                     "top": ranked(pois, row, original)}
                    for (query, expected), row, original in zip(examples, scores, origins)]
        split = len(fixtures["development"])
        threshold, margin = calibrate(rankings[:split])
        dev, dev_cases = measure(rankings[:split], threshold, margin)
        holdout, holdout_cases = measure(rankings[split:], threshold, margin)
        results["methods"][name] = {"threshold": threshold, "margin": margin,
                                     "development": dev, "holdout": holdout,
                                     "development_cases": dev_cases, "holdout_cases": holdout_cases}
        print(name, "threshold", threshold, "margin", margin, "holdout", holdout)
        if args.query:
            print("  ", ranked(pois, scores[-1], origins[-1]))
    if args.output:
        args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
