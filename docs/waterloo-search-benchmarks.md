# Waterloo rental search benchmarks

Runs on November 25, 2026 used an NVIDIA GeForce RTX 3080, the local search
worktree, and the local POI service backed by the Waterloo database. The latest
checkpoint, V14, builds on GLiNER2.5 with rental-specific span labels. These
results measure prompt interpretation in the experimental pipeline described in
[Search and places](architecture/Search%20and%20places.md).

## Full-query accuracy and parse latency

| Dataset and run | Full queries matched | Travel targets matched | Extra targets | Parse API p50 | Parse API p95 |
|---|---:|---:|---:|---:|---:|
| Original 400-query benchmark, earlier V13 parser | 273/400 (68.25%) | 180/202 | 16 | 34 ms | 69 ms |
| Original 400-query benchmark, V14 with revised parser | 393/400 (98.25%) | 200/202 | 0 | 31 ms | 50 ms |
| Earlier 60-query replay, V14 | 56/60 (93.3%) | 22/23 | 2 | 31 ms | 76 ms |
| New 60-query positive-only holdout, V14 first pass | 49/60 (81.7%) | 28/31 | 0 | 33 ms | 97 ms |

A full-query match requires all scored criteria, areas, destinations, travel
limits, specified modes, requirement strengths, and sort order to match the
expected intent. Extra criteria and destinations count as errors. The API
harness measured sequential wall time in the running parse handler, including
model calls and destination lookup. Every run in the table completed without
fallback or parse errors. Time to first listing results and routing accuracy
were outside the measurement.

The original benchmark scored 278/283 (98.2%) on its positive-only subset
after iterative parser work. The new positive holdout was frozen before
inference and kept out of training and parser tuning. It contains ten prompts
each for budget, layout, features, areas and leases, named travel, and multi-stop
travel. Positive queries include upper bounds and nice-to-haves. The prompts
are hand-authored and use local place names. The new holdout was below the 90%
full-query target.

## Raw model spans

Raw extraction uses a confidence threshold of 0.5 and requires the correct
field and exact character offsets. It runs GLiNER before deterministic parsing,
POI lookup, and choice classification.

| V14 dataset | Recall | Precision |
|---|---:|---:|
| Two earlier span suites, pooled | 415/421 (98.6%) | 415/431 (96.3%) |
| Separate 50-query span check | 147/156 (94.2%) | 147/156 (94.2%) |
| New 60-query positive-only holdout | 198/210 (94.3%) | 198/208 (95.2%) |

## Approach and remaining misses

- Fine-tuning used rental-specific examples across 21 span fields. V14 added
  160 training examples covering travel wording, cancelled destinations,
  amount boundaries, and rental features. Scoped Decide classification and the
  separate T5 rent adapter handled closed choices and spoken amounts.
- Explicit floor area is parsed directly. For “at least 1,300 square feet,” the
  parser extracts a minimum of 1,300. Destination hints inside duration spans
  are discarded, so “a bike ride of ten minutes or less to QNC” produces one
  10-minute bike trip to QNC.
- The new holdout missed four rent ceilings, including “Budget tops out at
  $1,690.” Other errors included required flags on explicitly optional filters,
  a time limit that failed to attach to Victoria Park, and an extra transit mode
  in “by bike or on foot.”

The 400-query comparison changes both the checkpoint and the parser. Its
accuracy improvement measures the combined pipeline.
