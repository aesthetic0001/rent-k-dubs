# Local search extraction

The Python process loads GLiNER2.5 and the trained T5 rent adapter once, extracts verbatim spans, and classifies closed choices from the relevant evidence. Each destination owns the duration and mode evidence in its clause. The web parser validates source offsets and maps results into `SearchIntent`, then uses its existing location resolver.

Set `SEARCH_EXTRACTOR_URL` on the web app to enable the service for `/api/search/parse`. A failed request falls back to basic parsing. `SEARCH_EXTRACTOR_TIMEOUT_MS` defaults to 2500. Listing explanations and area briefings use their existing provider configuration.

## Run on the workstation

With the extractor dependencies installed, run from the repository root.

```sh
export HF_HOME="$PWD/local/models/hf"
local/.venv/bin/python apps/search/server.py
```

The first startup downloads the [V14 GLiNER checkpoint](https://huggingface.co/aesthetic0001/rent-k-dubs-search-v14/tree/91024c659b8efcba7f31986b220a7faa3a933402),
the [V5 rent adapter](https://huggingface.co/aesthetic0001/rent-k-dubs-rent-t5-adapter-v5/tree/0105f7f5de692df516479b7198ad917ff3de9fd7),
and their T5 dependencies. The downloader pins Hub commits and checks the SHA-256 of the
[NVIDIA NeMo ITN decoder 1.11.0](https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/itn_en_t5/1.11.0/file-browser).
NVIDIA provides that decoder under the terms in its model card. The service reuses the model cache on later starts.
Set `HF_HUB_OFFLINE=1` to require cached artifacts or local overrides.

Set `SEARCH_EXTRACTOR_URL=http://127.0.0.1:8081` for a web process on the same host.
`GET /health` becomes available once the models are loaded. `SEARCH_MODEL_THREADS`
defaults to two. Set `SEARCH_CLASSIFIER_MODEL=fastino/GLiNER2.5-Decide` to use
the optional scoped classifier. The web parser makes criteria must-haves by
default and reads explicit preference cues from the prompt. Field definitions
and closed choices live in [server.py](server.py) and [labels.py](labels.py).

Set `SEARCH_MODEL_DEVICE=cuda` in a CUDA-enabled PyTorch environment to run
extraction, classification, and rent normalization on an NVIDIA GPU. The default
device is `cpu`. The model confidence threshold defaults to `0.5` and can be
set with `SEARCH_MODEL_SPAN_THRESHOLD`.

For an existing local bundle, override any of `GLINER_MODEL`, `SEARCH_T5_CONFIG`
(the T5 architecture and tokenizer directory), `SEARCH_T5_CHECKPOINT` (the
NeMo archive), or `SEARCH_T5_ADAPTER` (the PEFT directory).

## Compose

Set `SEARCH_EXTRACTOR_URL=http://search-extractor:8081` in the root `.env` and
run `docker compose --profile search up -d --build search-extractor web`.
The CPU extractor stays on the private Compose network. The `search-models`
volume retains downloaded weights when the service is recreated.

## Evaluation

Use the [Waterloo rental evaluation set](evaluation/README.md) to benchmark
prompt interpretation on 500 labeled queries. The [published benchmark](../../docs/waterloo-search-benchmarks.md) records accuracy and latency.
