# Local search extraction

The Python process loads GLiNER2.5 and the trained T5 rent adapter once, extracts verbatim spans, and classifies closed choices from the relevant evidence. Each destination owns the duration and mode evidence in its clause. The web parser validates source offsets and maps results into `SearchIntent`, then uses its existing location resolver.

Set `SEARCH_EXTRACTOR_URL` on the web app to enable the service for `/api/search/parse`. A failed request falls back to basic parsing. `SEARCH_EXTRACTOR_TIMEOUT_MS` defaults to 2500. Listing explanations and area briefings use their existing provider configuration.

## Run on the workstation

With the model bundle under `local/models` and the experiment Python environment installed, run from the repository root.

```sh
export HF_HOME="$PWD/local/models/hf"
export SEARCH_T5_CONFIG="$PWD/local/models/nvidia/t5-small"
export SEARCH_T5_CHECKPOINT="$PWD/local/models/nvidia/decoder.nemo"
export SEARCH_T5_ADAPTER="$PWD/local/models/nvidia/dollar-adapter-v5"
local/.venv/bin/python apps/search/server.py
```

Set `SEARCH_EXTRACTOR_URL=http://127.0.0.1:8081` for a web process on the same host. `GET /health` is available once the models are loaded. `SEARCH_MODEL_THREADS` defaults to two. Set `SEARCH_CLASSIFIER_MODEL=fastino/GLiNER2.5-Decide` to classify extracted spans with preset choices, such as travel mode, amenity category, and lease type. The base path interprets bounds. The web parser makes criteria must-haves by default and reads explicit preference cues from the prompt. Tune label descriptions in [labels.py](labels.py).

Set `SEARCH_MODEL_DEVICE=cuda` in a CUDA-enabled PyTorch environment to run extraction, classification, and rent normalization on an NVIDIA GPU. The default is `cpu`.

Set `GLINER_MODEL` to a compatible local GLiNER checkpoint for comparison runs.
The benchmarked V14 weights and T5 files are workstation model artifacts.
`SEARCH_MODEL_SPAN_THRESHOLD` controls span extraction and defaults to `0.5`.
Measure both recall and precision on held-out queries before choosing a threshold.

## Container

Build with `docker build -t rent-search-extractor apps/search`. On the workstation that owns the model files, run the container as your user so it can read the adapter.

```sh
docker run --rm --name search-extractor --user "$(id -u):$(id -g)" \
  --network rentkdubs_default -v "$PWD/local/models:/models:ro" \
  -e HF_HOME=/models/hf -e HF_HUB_OFFLINE=1 \
  -e SEARCH_T5_CONFIG=/models/nvidia/t5-small \
  -e SEARCH_T5_CHECKPOINT=/models/nvidia/decoder.nemo \
  -e SEARCH_T5_ADAPTER=/models/nvidia/dollar-adapter-v5 rent-search-extractor
```

On that private network, set `SEARCH_EXTRACTOR_URL=http://search-extractor:8081` on the web app.

## Evaluation

Use the [Waterloo rental evaluation set](evaluation/README.md) to benchmark
prompt interpretation on 500 labeled queries. The [published benchmark](../../docs/waterloo-search-benchmarks.md) records accuracy and latency.
