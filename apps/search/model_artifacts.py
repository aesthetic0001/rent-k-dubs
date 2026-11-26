"""Pinned default model artifacts for the local search service."""

import hashlib
import os
from pathlib import Path
import shutil
from tempfile import NamedTemporaryFile
from urllib.request import urlopen

from huggingface_hub import constants, snapshot_download
from huggingface_hub.errors import LocalEntryNotFoundError

V14 = ("aesthetic0001/rent-k-dubs-search-v14", "91024c659b8efcba7f31986b220a7faa3a933402",
       ("config.json", "encoder_config/config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json"))
T5_CONFIG = ("google-t5/t5-small", "df1b051c49625cf57a3d0d8d3863ed4d13564fe4",
             ("config.json", "spiece.model", "tokenizer.json", "tokenizer_config.json"))
T5_ADAPTER = ("aesthetic0001/rent-k-dubs-rent-t5-adapter-v5", "0105f7f5de692df516479b7198ad917ff3de9fd7",
              ("adapter_config.json", "adapter_model.safetensors"))
DECODER_URL = (
    "https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/itn_en_t5/1.11.0/"
    "download-file?path=itn_en_t5_decoder.nemo"
)
DECODER_SHA256 = "302ba43d631fe89679522213bc4bd632f73685d31657329954e4cc05f64c6497"


def hub_model(repo_id, revision, files):
    options = dict(revision=revision, allow_patterns=files, token=False)
    try:
        directory = Path(snapshot_download(repo_id, local_files_only=True, **options))
        if all((directory / name).is_file() for name in files):
            return directory
    except LocalEntryNotFoundError:
        pass
    directory = Path(snapshot_download(repo_id, **options))
    if missing := [name for name in files if not (directory / name).is_file()]:
        raise FileNotFoundError(f"Incomplete model snapshot for {repo_id}: {', '.join(missing)}")
    return directory


def nvidia_decoder():
    destination = Path(constants.HF_HOME) / "rent-k-dubs" / "itn_en_t5_decoder-1.11.0.nemo"

    def checksum(path):
        with path.open("rb") as artifact:
            return hashlib.file_digest(artifact, "sha256").hexdigest()

    if destination.is_file() and checksum(destination) == DECODER_SHA256:
        return destination
    if constants.HF_HUB_OFFLINE:
        raise FileNotFoundError("NVIDIA T5 decoder is missing or invalid in the offline cache. Set SEARCH_T5_CHECKPOINT or warm the cache.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=destination.parent, delete=False) as artifact:
        temporary = Path(artifact.name)
    try:
        with urlopen(DECODER_URL, timeout=60) as response, temporary.open("wb") as artifact:
            shutil.copyfileobj(response, artifact)
        if checksum(temporary) != DECODER_SHA256:
            raise ValueError("Downloaded NVIDIA T5 decoder failed the SHA-256 check.")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def model_paths():
    return (
        os.getenv("GLINER_MODEL") or hub_model(*V14),
        os.getenv("SEARCH_T5_CONFIG") or hub_model(*T5_CONFIG),
        os.getenv("SEARCH_T5_CHECKPOINT") or nvidia_decoder(),
        os.getenv("SEARCH_T5_ADAPTER") or hub_model(*T5_ADAPTER),
    )
