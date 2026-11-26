# Waterloo rental search evaluation

[waterloo-rentals-v1.json](waterloo-rentals-v1.json) contains 500 authored rental
queries with expected filters and travel targets. The prompts are synthetic and
use real local place names. Each of the ten groups has 10 development examples
and 40 holdout examples. Use the 100 development examples for iteration and
keep the 400 holdout examples out of fine-tuning and prompt development.

| Group | What it exercises |
|---|---|
| Budget | Spoken amounts, ranges, per-room rent, decoy income |
| Layout | Unit type alternatives, bedroom and bathroom bounds, floor area |
| Features | Pets, AC, laundry, utilities, parking, furnishing |
| Lease and age | Move-in dates, lease terms, and construction years |
| Neighbourhood | District names, explicit alternatives, and area versus destination |
| Named destination | Landmark aliases, campus codes, branches, and street qualifiers |
| Generic amenity | Amenity categories and elementary versus secondary school |
| Multiple trips | Per-destination limits, alternatives, and same-category targets |
| Preference scope | Required filters and explicit flexibility in the same prompt |
| Corrections and distractors | Revised decisions, negation, unsupported filters, browsing |

The labels use the search API's values. Money is monthly CAD. Numeric limits
record the stated threshold. Dates are ISO calendar dates. The reference date
is fixed in the fixture. A missing travel mode leaves the parser's default
unscored. A null travel limit means the prompt leaves the time unspecified.
The scorer checks named destinations separately from generic amenity categories,
compares alternative modes as a set, and treats unexpected filters and duplicate
trips as errors.

## Run the benchmark

Start the local [extractor](../README.md) and [POI service](../../poi/README.md),
then run from the repository root.

    SEARCH_EXTRACTOR_TEST_URL=http://127.0.0.1:8081 \
    POI_TEST_URL=http://127.0.0.1:8082 \
    SEARCH_EVAL_OUTPUT=/tmp/waterloo-rental-evaluation.json \
    pnpm --filter web exec vitest run src/lib/parse/rental-evaluation.test.ts

The default split is the 400 holdout cases. Set SEARCH_EVAL_SPLIT to development
or all to select another set. Set SEARCH_EVAL_LIMIT=20 to sample evenly across
the selected set for a smoke test. Omit the extractor URL for the deterministic
fallback baseline. The normal test suite validates the fixture without either
service.

Set `SEARCH_EVAL_DATASET` to the path of another fixture with the same schema
to evaluate a fresh test set through the same API. Keep test prompts and close
paraphrases out of adapter training.

The JSON report includes exact prompt matches, matched and extra criteria and
trips, parser fallbacks, per-group scores, timing and per-prompt differences.
Timing covers the parse API handler, including any configured model calls and
destination lookup. The gold labels evaluate prompt interpretation. Location
identity, routing accuracy and listing relevance need separate ground truth.
