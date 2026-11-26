# Waterloo POI semantic search findings

Fuzzy agreement improved the first result for all three local embedding models on 188 held-out Waterloo queries. **BGE-base with fuzzy boosting ranked 186 of 188 targets first**. **BGE-small with boosting ranked 185 first** and took about 10 ms less per query at the median on the benchmark machine. E5-small with boosting placed all 188 targets in the top three.

## Data and evaluation

- The index used for the main tests contains **513 records** inside the City of Waterloo. It includes 290 OpenStreetMap POIs from the local PostgreSQL export, 208 UW building records, and 15 other named places. City membership was computed with PostGIS against the union of the local Waterloo neighbourhood polygons. Intersections were excluded.
- The [frozen OSM input](semantic-search-results/osm-pois.json.gz) includes 724 rows from the wider Waterloo area. The export was enriched by fetching the corresponding OSM elements by ID and retaining their available street, house number, city, and alias tags. There are 168 street-tagged records in the city index. The [city ID list](semantic-search-results/waterloo-ids.json) captures the boundary decision. The evaluator adds the checked-in [curated](../apps/web/src/lib/parse/known_places.json) and [generated](../apps/web/src/lib/parse/known_places.generated.json) known places.
- The [expanded fixture](../prototypes/poi-search/waterloo-expanded-cases.json) has 13 development phrases and **188 handwritten held-out phrases covering 182 distinct targets**. The held-out target IDs are disjoint from the development set and the initial 20-case holdout. The [shorthand fixture](../prototypes/poi-search/waterloo-shorthand-cases.json) has 48 phrases covering 16 campus codes in bare, UW-prefixed, and descriptive forms.
- All targets in the city suites exist in the index. The queries were supplied directly as destination phrases. They measure retrieval and ranking from a correct extraction. The acceptance thresholds were fitted on the 13 development phrases, prioritizing fewer wrong acceptances. The city suites cannot calibrate how to handle absent or genuinely ambiguous targets.

The frozen OSM input contains public POI data, © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright).

## Prototype implementation

The [evaluator](../prototypes/poi-search/evaluate.py) embeds one document per catalogue record, using the name, aliases, category, subcategory, and address fields where available. Each document points to its existing POI ID and coordinates. For example, the Sobeys on Bridgeport document includes the name and `94 Bridgeport Road East`. All document embeddings are precomputed for the run. The complete input phrase is then embedded with the same model.

- **BGE-small and BGE-base** use the BGE search instruction on queries, CLS pooling, and L2 normalization. **E5-small** adds `query:` or `passage:`, averages the unmasked token vectors, and applies L2 normalization. The evaluator caps inputs at 96 tokens. It keeps the exact cosine score for every record and sorts the candidates.
- The [fuzzy lookup](../prototypes/poi-search/fuzzy.py) scans spans from the original phrase against names and aliases and against street names and house numbers. It accepts name similarities of at least `0.82` and street similarities of at least `0.90`. It keeps the best three distinct normalized matching values per field, including all branches attached to a shared name. Explicit street directions and house numbers must agree to earn address evidence. Partial names contribute less than a full matching name or alias.
- For each of the top 12 semantic candidates, let `c` be the cosine score, `n` the candidate's strongest retained name match, and `s` its strongest retained street match. The reranked score is `c + max(0, c) × (0.085n + 0.045s + 0.055ns)`. Missing evidence is zero. The interaction rewards one record supported by both fields. The hybrid score can exceed 1 and is not a calibrated probability.
- The evaluator also reports a TF-IDF cosine baseline, an address-free semantic run, and an earlier explicit-street guard. The guard is useful for comparison but was brittle when a phrase such as “on Forestlawn, Waterloo” included a city qualifier.

## Results

### Expanded Waterloo benchmark

Counts are out of 188. The reported decision uses the cutoff and runner-up margin selected on the development subset.

| Model | First result, plain → hybrid | Top three, plain → hybrid | Wrongly accepted, plain → hybrid | Unresolved, plain → hybrid | Median, plain → hybrid | p95, plain → hybrid |
|---|---:|---:|---:|---:|---:|---:|
| BGE-small | 183 → 185 | 186 → 187 | 4 → 3 | 2 → 0 | 5.3 → 16.2 ms | 6.2 → 24.0 ms |
| BGE-base | 185 → 186 | 187 → 187 | 2 → 2 | 1 → 0 | 15.8 → 26.4 ms | 17.3 → 34.7 ms |
| E5-small | 178 → 182 | 188 → 188 | 10 → 6 | 0 → 0 | 4.6 → 15.2 ms | 5.1 → 23.5 ms |

Lexical matching alone ranked 172 first and 182 in the top three. The warm CPU timings are for a Ryzen 9 9900X using four PyTorch threads and precomputed POI vectors. They include query embedding and exact ranking, plus lookup and reranking for the hybrid. Model load, GLiNER2 extraction, and application overhead were outside the measurement. Encoding the 513 records took 1.46 s for BGE-small, 5.28 s for BGE-base, and 1.57 s for E5-small.

- **Branch identity.** BGE-base moved the Shoppers on King Street South above the North branch. For “Sobeys on Bridgeport,” its hybrid score gained 0.139 for the correct branch and about 0.056 for each of the next two name-only matches.
- **Remaining errors.** BGE-base still returned United College Main Building for the main WLU campus and University of Waterloo Place for the main UW campus. E5-small promoted Mary Allen Park over Allen ION station. The current boost gives shared words credit even when the intended place type differs.

### UW shorthands

| Model | First result, plain | First result, hybrid | Bare codes, hybrid |
|---|---:|---:|---:|
| BGE-small | 28/48 | 43/48 | 16/16 |
| BGE-base | 36/48 | 48/48 | 16/16 |
| E5-small | 40/48 | 48/48 | 16/16 |

All three hybrids correctly resolved the six UWP and CMH variants. All 16 bare codes in the sample are unique exact aliases in the city catalogue. For a later implementation, a unique exact alias can be resolved directly. The sample leaves shared codes and ambiguous aliases unmeasured.

### Raw reports

| Model | Expanded holdout | Campus shorthands | Initial 20-case run |
|---|---|---|---|
| BGE-small | [JSON.gz](semantic-search-results/expanded/bge-small-en-v1.5.json.gz) | [JSON.gz](semantic-search-results/shorthand/bge-small-en-v1.5.json.gz) | [JSON.gz](semantic-search-results/initial/bge-small-en-v1.5.json.gz) |
| BGE-base | [JSON.gz](semantic-search-results/expanded/bge-base-en-v1.5.json.gz) | [JSON.gz](semantic-search-results/shorthand/bge-base-en-v1.5.json.gz) | [JSON.gz](semantic-search-results/initial/bge-base-en-v1.5.json.gz) |
| E5-small | [JSON.gz](semantic-search-results/expanded/e5-small-v2.json.gz) | [JSON.gz](semantic-search-results/shorthand/e5-small-v2.json.gz) | [JSON.gz](semantic-search-results/initial/e5-small-v2.json.gz) |

The [initial Waterloo-area run](semantic-search-results/initial/waterloo-area.json.gz) also tested 28 holdout phrases against 970 records, including targets that should stay unresolved. Its data split and geographic scope differ from the city benchmarks. The compressed files preserve each original report, including per-query rankings and acceptance decisions.

## Reproduce locally

Run from the repository root at this change. The checked-in known-places files are the versions from `910578e12867a7785250e95c244db37026eee9cf`. The saved inputs remove the need for a database or a fresh OpenStreetMap fetch. The benchmark used Python 3.12.3, PyTorch 2.15.0, NumPy 2.5.5, Transformers 5.24.1, and Hugging Face Hub 2.4.0.

1. Prepare a Python environment.

   ```sh
   python3.12 -m venv /tmp/poi-benchmark-venv
   . /tmp/poi-benchmark-venv/bin/activate
   python -m pip install 'torch==2.15.0' 'numpy==2.5.5' 'transformers==5.24.1' \
     'huggingface-hub==2.4.0' 'tokenizers==0.23.3' 'safetensors==0.8.0'
   ```

2. Download the pinned public models once. The evaluator subsequently uses cached weights in offline mode.

   ```sh
   python - <<'PY'
   from huggingface_hub import snapshot_download

   revisions = {
       "BAAI/bge-small-en-v1.5": "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
       "BAAI/bge-base-en-v1.5": "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a",
       "intfloat/e5-small-v2": "ffb93f3bd4047442299a41ebb6fa998a38507c52",
   }
   for model, revision in revisions.items():
       snapshot_download(model, revision=revision, allow_patterns=[
           "config.json", "tokenizer*", "special_tokens_map.json",
           "vocab.txt", "model.safetensors",
       ])
   PY
   ```

3. Run both suites for each model. Output reruns to a temporary directory to preserve the archived measurements.

   ```sh
   poi_run=$(mktemp -d)
   gzip -dc docs/semantic-search-results/osm-pois.json.gz > "$poi_run/osm-pois.json"
   export HF_HUB_OFFLINE=1 OPENBLAS_NUM_THREADS=1

   for suite in expanded shorthand; do
     for model in BAAI/bge-small-en-v1.5 BAAI/bge-base-en-v1.5 intfloat/e5-small-v2; do
       python prototypes/poi-search/evaluate.py "$poi_run/osm-pois.json" \
         --allowed-ids docs/semantic-search-results/waterloo-ids.json \
         --cases "prototypes/poi-search/waterloo-$suite-cases.json" \
         --model "$model" --output "$poi_run/$suite-${model##*/}.json"
     done
   done
   printf '%s\n' "$poi_run"
   ```

For the initial city comparison, use [`waterloo-cases.json`](../prototypes/poi-search/waterloo-cases.json). For the initial regional run, use [`cases.json`](../prototypes/poi-search/cases.json), select BGE-small, and omit `--allowed-ids`. Compare rank and acceptance totals rather than expecting timings to repeat on another machine. Use `gzip -dc path/to/report.json.gz` to inspect an archived report.
