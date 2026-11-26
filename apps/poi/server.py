"""HTTP service for catalogue mentions and destination resolution."""

import json
import logging
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from catalogue import BgeEncoder, Catalogue, load_places, utf16


def serve(catalogue, host, port):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.request.settimeout(3)

        def log_message(self, _format, *_args):
            return

        def respond(self, status, data):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path == "/health":
                self.respond(200, {"places": len(catalogue.places)})
            else:
                self.respond(404, {"error": "Not found"})

        def do_POST(self):
            if self.path not in {"/mentions", "/resolve"}:
                self.respond(404, {"error": "Not found"})
                return
            mentions = self.path == "/mentions"
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 32768:
                    raise ValueError("Invalid body length")
                data = json.loads(self.rfile.read(length))
                text = data.get("prompt" if mentions else "query") if isinstance(data, dict) else None
                if not isinstance(text, str) or not text.strip() or utf16(text) > (4000 if mentions else 500):
                    raise ValueError("Invalid place input")
                near = data.get("near")
                if near is not None and (not isinstance(near, dict) or any(
                    type(near.get(axis)) not in {int, float} or not -limit <= near[axis] <= limit
                    for axis, limit in (("lat", 90), ("lng", 180))
                )):
                    raise ValueError("Invalid origin")
            except (ValueError, TimeoutError):
                self.respond(422, {"error": "Invalid place input"})
                return
            try:
                result = ({"mentions": catalogue.mentions(text)} if mentions else
                          catalogue.resolve(text.strip(), data.get("preferPrimaryCampus") is not False, near))
            except Exception as error:
                logging.error("Place lookup failed: %s", type(error).__name__)
                self.respond(503, {"error": "Place lookup unavailable"})
                return
            self.respond(200, result)

    with HTTPServer((host, port), Handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    known_dir = Path(os.getenv("POI_KNOWN_PLACES_DIR",
                               Path(__file__).resolve().parents[1] / "web/src/lib/parse"))
    try:
        places = load_places(os.environ["DATABASE_URL"], known_dir)
        catalogue = Catalogue(places, BgeEncoder())
    except Exception as error:
        logging.error("Could not initialize place catalogue: %s", type(error).__name__)
        raise SystemExit(1)
    serve(catalogue, os.getenv("POI_SERVICE_HOST", "127.0.0.1"), int(os.getenv("POI_SERVICE_PORT", "8082")))
