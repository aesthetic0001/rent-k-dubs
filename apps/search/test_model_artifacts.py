import hashlib
from io import BytesIO
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from model_artifacts import constants, hub_model, model_paths, nvidia_decoder, V14


class ModelArtifactsTest(unittest.TestCase):
    def test_pins_default_gliner_and_preserves_local_overrides(self):
        with patch.dict(os.environ, {"SEARCH_T5_CONFIG": "config", "SEARCH_T5_CHECKPOINT": "decoder",
                                      "SEARCH_T5_ADAPTER": "adapter"}, clear=True):
            with patch("model_artifacts.hub_model", return_value=Path("v14")) as download:
                self.assertEqual(model_paths(), (Path("v14"), "config", "decoder", "adapter"))
                download.assert_called_once_with(*V14)
                os.environ["GLINER_MODEL"] = "local"
                self.assertEqual(model_paths(), ("local", "config", "decoder", "adapter"))
                download.assert_called_once()

    def test_incomplete_hub_snapshot_is_completed(self):
        with TemporaryDirectory() as folder, patch("model_artifacts.snapshot_download") as download:
            root = Path(folder)

            def snapshot(_, **options):
                if not options.get("local_files_only"):
                    (root / "weights").touch()
                return folder

            download.side_effect = snapshot
            self.assertEqual(hub_model("org/repo", "revision", ("weights",)), root)
            self.assertEqual(download.call_count, 2)
            self.assertEqual(download.call_args.kwargs, {"revision": "revision",
                                                        "allow_patterns": ("weights",), "token": False})

    def test_decoder_rejects_bad_bytes_and_reuses_good_download_offline(self):
        with TemporaryDirectory() as folder, patch.object(constants, "HF_HOME", folder), \
             patch.object(constants, "HF_HUB_OFFLINE", False), \
             patch("model_artifacts.DECODER_SHA256", hashlib.sha256(b"valid").hexdigest()), \
             patch("model_artifacts.urlopen", side_effect=[BytesIO(b"bad"), BytesIO(b"valid")]) as fetch:
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                nvidia_decoder()
            self.assertEqual(list(Path(folder).rglob("*.nemo")), [])
            model = nvidia_decoder()
            with patch.object(constants, "HF_HUB_OFFLINE", True):
                self.assertEqual(nvidia_decoder(), model)
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(model.read_bytes(), b"valid")
