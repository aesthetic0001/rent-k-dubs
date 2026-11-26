"""Local evidence extraction for the rental search parser."""

import json
import logging
import os
import re
import tarfile
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, HTTPServer

import torch
from gliner2 import AutoExtractor
from peft import PeftModel
from transformers import AutoConfig, AutoTokenizer, T5ForConditionalGeneration
from labels import AMENITIES, BOOLEANS, BOUNDS, CHOICES, DECIDE_CHOICES, MODES, NUMBERS, generic_amenity

FIELDS = {
    "rent": "Verbatim monthly rental budget amount, including currency or scale words if present. Exclude annual income, percentages and other quantities.",
    "bedrooms": "Explicit bedroom count or range with its bedroom unit.",
    "bathrooms": "Explicit bathroom count or range with its bathroom unit.",
    "sizeSqft": "Explicit minimum, maximum or range of unit square footage.",
    "unitTypes": "Verbatim allowed or excluded rental unit types such as apartment, condo, basement, studio, house, townhouse or room.",
    "buildingAge": "Explicit desired age or construction year of the building.",
    "airConditioning": "Explicit air conditioning request including any or central AC.",
    "petsAllowed": "Explicit requirement about allowing cats, dogs or pets.",
    "furnished": "Explicit furnished or unfurnished request.",
    "parking": "Explicit desired or excluded parking.",
    "laundryInSuite": "Explicit in-suite laundry requirement.",
    "utilitiesIncluded": "Explicit request about whether rent includes utilities.",
    "availableBy": "Requested date for move-in or availability.",
    "leaseTerm": "Requested lease duration or short-term lease type.",
    "area": "Exact neighbourhood or district name for where the rental should be located.",
    "destination": "Verbatim name of a specific physical destination, including branch or street qualifiers. Examples: UW, T&T, Waterloo Park, Waterloo Public Library, Kitchener GO Station. Exclude generic types, time limits and travel modes.",
    "amenity": "Verbatim request for any nearby instance of a place category, such as groceries, a supermarket, the public library, an elementary school or a park. Exclude named locations such as T&T, Waterloo Public Library and Waterloo Park.",
    "sort": "Explicit request for result ordering, such as lowest rent, newest listings, best value or shortest trips.",
    "tripDuration": "Verbatim travel time, including the minutes or hours unit, for reaching a requested destination. Exclude lease periods and dates.",
    "tripMode": "Verbatim explicit means of transportation, such as biking or taking the bus. Exclude station or destination names.",
    "tripPreference": "Verbatim proximity wording tied to a requested destination, such as near, close to, or walking distance to.",
}

MODEL = "fastino/gliner2.5-base-v1"
WRITTEN_AMOUNT = re.compile(r"(?:(?:cad|c\$|\$)\s*)?[\d,.]+\s*k?(?:\s*(?:cad|dollars?|bucks))?", re.I)
NUMBER = re.compile(r"[0-9](?:\s*[0-9])*\s*(?:\.\s*[0-9](?:\s*[0-9])*)?")
BREAKS = re.compile(r"[,;!?\n]|\.(?=\s|$)")
BOOLEANS_CHOICE = {"yes": "explicitly wants the named feature", "no": "explicitly wants the named feature absent", "unspecified": "no preference stated"}


def utf16_offset(text, index):
    return len(text[:index].encode("utf-16-le")) // 2


def amount_input(span):
    text = re.sub(r"(?<=[a-z])-(?=[a-z])", " ", span.lower())
    text = re.sub(r"[0-9][0-9.,]*", lambda match: f" {' '.join(match[0])} ", text)
    return f"0 <extra_id_0> {' '.join(text.split())} <extra_id_1>"


def source_clause(prompt, start, end, previous=0):
    breaks = [match.end() for match in BREAKS.finditer(prompt, previous, start)]
    left = breaks[-1] if breaks else previous
    while left < start and prompt[left] in " ,\t":
        left += 1
    return {"text": prompt[left:end], "start": left, "end": end}


def candidate_trips(prompt, entities, places):
    times = entities.get("tripDuration", [])
    areas = [
        area for area in entities.get("area", [])
        if re.search(r"\b(?:in\s+(?:the\s+)?|neighbou?rhood\s+)$", prompt[:area["start"]], re.I)
    ]
    def is_destination(span):
        before = source_clause(prompt, span["start"], span["start"])["text"]
        clause = re.split(r"\bbut\b|\band\s+(?:i|we)\s+(?:need|want|require)\b", before + span["text"], flags=re.I)[-1]
        after = prompt[span["end"]:]
        declined = re.search(r"\bdon['’]t (?:want|need)\b", clause, re.I)
        limited = declined and re.search(
            r"\b(?:more than|longer than|over)\b", clause[declined.end():], re.I
        )
        return not (
            any(area["start"] <= span["start"] < area["end"] for area in areas)
            or any(time["start"] <= span["start"] and span["end"] <= time["end"] for time in times)
            or re.search(r"\b(?:even if|formerly|used to (?:live|work|commute)|stopped commuting|(?:months?|years?) ago|"
                         r"(?:ignore|skip|drop|forget) (?:my|the|that)|no need to|nothing for|though (?:i|we) work out of|"
                         r"don['’]t solve for|"
                         r"don['’]t prioritize)\b", clause, re.I)
            or declined and not limited
            or re.match(r"\s+(?:can|should) be ignored\b", after, re.I)
            or re.match(r"\s+(?:neighbou?rhood|district)\b", after, re.I)
            or re.match(r"\s+allowance\b", after, re.I)
        )

    hints = [place for place in places if is_destination(place)]
    for match in re.finditer(
        r"(?i:\b(?:i|we) work (?:at|beside|near)\s+(?:the\s+)?)([A-Z][\w’'-]*(?:\s+[A-Z][\w’'-]*)+)"
        r"(?i:(?=,\s*and\s+(?:(?:i|we)\s+)?need\b))",
        prompt,
    ):
        start, end = match.span(1)
        stop = BREAKS.search(prompt, end + 1)
        if any(end < time["start"] < (stop.start() if stop else len(prompt)) for time in times):
            hints.append({"start": start, "end": end, "text": match[1]})
    anchors = [("destination", place, None) for place in hints]
    for field in ("destination", "amenity"):
        for span in entities.get(field, []):
            if not is_destination(span):
                continue
            lead = re.match(r"(?:(?:i (?:only )?(?:need|want)|we (?:need|want)|must have|ideally|both)\s+)+", span["text"], re.I)
            if lead and lead.end() < len(span["text"]):
                start = span["start"] + lead.end()
                span = {**span, "start": start, "text": prompt[start:span["end"]]}
            known = any(span["start"] < p["end"] and p["start"] < span["end"] for p in hints)
            if known and field == "amenity":
                continue
            category = None if known else generic_amenity(span["text"])
            anchors.append(("amenity" if category else field, span, category))
    anchors.sort(key=lambda item: (item[1]["start"], -(item[1]["end"] - item[1]["start"])))
    distinct = []
    for item in anchors:
        if not distinct or item[1]["start"] >= distinct[-1][1]["end"]:
            distinct.append(item)
    modes = entities.get("tripMode", [])
    proximity = entities.get("tripPreference", [])
    slots = []
    previous = 0
    for index, (field, anchor, category) in enumerate(distinct):
        following = distinct[index + 1][1] if index + 1 < len(distinct) else None
        right = following["start"] if following else len(prompt)
        for boundary in BREAKS.finditer(prompt, anchor["end"], right):
            if boundary.group() == "," and any(
                boundary.end() <= time["start"] < right
                and re.fullmatch(r"\s*(?:(?:ideally|preferably|about|around|roughly|under|within|at most|no more than|"
                                 r"which should be|and (?:i |we )?need)\s+)+(?:an?\s+)?",
                                 prompt[boundary.end():time["start"]], re.I)
                for time in times
            ):
                continue
            if boundary.group() == "." and re.match(
                r"\s*(?:keep|make|limit)\b[^.!?;,]{0,70}\bthere\b", prompt[boundary.end():right], re.I
            ):
                continue
            right = boundary.start()
            break
        if following:
            gap = prompt[anchor["end"]:right]
            if join := re.search(r"\b(?:and|or(?!\s+(?:less|more|(?:(?:by|on)\s+)?"
                                 r"(?:foot|bike|bicycle|bus|transit|car|drive|walk)"
                                 r"(?=\s*(?:$|and\b|of the same duration\b))))|plus|but)\b", gap, re.I):
                right = anchor["end"] + join.start()
            elif re.search(r"\b(?:to|of|from|near)\s+(?:(?:a|an|the)\s+)?$", gap, re.I):
                # The gap introduces the next destination, so its time and mode belong there.
                right = anchor["end"]
        source = source_clause(prompt, anchor["start"], anchor["end"], previous)
        before = lambda span: source["start"] <= span["start"] < span["end"] <= anchor["start"]
        after = lambda span: anchor["end"] <= span["start"] < span["end"] <= right
        duration = max(filter(before, times), key=lambda s: s["end"], default=None)
        if duration:
            # Bound preceding prose to the last coordination before the duration.
            joins = list(re.finditer(r"\band\b", prompt[source["start"]:duration["start"]], re.I))
            if joins:
                source = source_clause(prompt, anchor["start"], anchor["end"], source["start"] + joins[-1].end())
        else:
            duration = min(filter(after, times), key=lambda s: s["start"], default=None)
        explicit_modes = sorted((s for s in modes if before(s) or after(s)), key=lambda s: s["start"])
        if duration and duration["end"] <= anchor["start"] and not explicit_modes:
            between = prompt[duration["end"]:anchor["start"]]
            hint = re.sub(r"\b(?:to|of|from)(?:\s+(?:a|an|the))?\s*$", "", between, flags=re.I).strip()
            if hint:
                start = duration["end"] + between.index(hint)
                explicit_modes = [{"text": hint, "start": start, "end": start + len(hint)}]
        modes_in_clause = []
        for span in explicit_modes:
            matches = list(re.finditer(r"\b(?:or|and)\b|/", span["text"], re.I))
            starts = [0, *[match.end() for match in matches]]
            ends = [*[match.start() for match in matches], len(span["text"])]
            for left, stop in zip(starts, ends, strict=True):
                segment = span["text"][left:stop]
                text = segment.strip()
                if text:
                    start = span["start"] + left + len(segment) - len(segment.lstrip())
                    modes_in_clause.append({"text": text, "start": start, "end": start + len(text)})
        cue = max(filter(before, proximity), key=lambda s: s["end"], default=None)
        if duration is None and cue is not None:
            source = source_clause(prompt, anchor["start"], anchor["end"], cue["start"])
        tail = ([duration] if duration else []) + modes_in_clause
        end = max([anchor["end"], *(span["end"] for span in tail)])
        if duration and (alternative := re.match(
            r"\s+or\s+((?:(?:by|on)\s+)?(?:foot|bike|bicycle|bus|transit|car|drive|walk))\b", prompt[end:right], re.I
        )):
            left, stop = alternative.span(1)
            modes_in_clause.append({"text": alternative[1], "start": end + left, "end": end + stop})
            end += alternative.end()
        suffix = re.match(r"\s+(?:or (?:less|more)|tops|at (?:most|least))\b", prompt[end:right], re.I)
        if suffix and end > anchor["end"]:
            end += suffix.end()
        source = {**source, "end": end, "text": prompt[source["start"]:end]}
        previous = end
        slot = {"destination": anchor, "source": source, "duration": duration,
                "modeSpans": modes_in_clause, "amenity": field == "amenity"}
        if category:
            slot["category"] = category
        slots.append(slot)
    return slots


def inline_span(prompt, span):
    return {**span, "start": utf16_offset(prompt, span["start"]), "end": utf16_offset(prompt, span["end"])}


def validated_places(prompt, places):
    if not isinstance(places, list) or not places:
        return []
    offset = 0
    indices = {0: 0}
    for index, character in enumerate(prompt, 1):
        offset += 2 if ord(character) > 65535 else 1
        indices[offset] = index
    result = []
    for place in places[:128]:
        if not isinstance(place, dict) or type(place.get("start")) is not int or type(place.get("end")) is not int:
            continue
        start, end = indices.get(place["start"]), indices.get(place["end"])
        if start is not None and end is not None and start < end and prompt[start:end] == place.get("text"):
            result.append({"text": prompt[start:end], "start": start, "end": end})
    return result


class Extractor:
    def __init__(self):
        torch.set_num_threads(max(1, int(os.getenv("SEARCH_MODEL_THREADS", "2"))))
        self.device = torch.device(os.getenv("SEARCH_MODEL_DEVICE", "cpu"))
        if self.device.type == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("SEARCH_MODEL_DEVICE requests CUDA, but PyTorch cannot access a CUDA GPU")
        self.span_threshold = float(os.getenv("SEARCH_MODEL_SPAN_THRESHOLD", "0.5"))
        if not 0 < self.span_threshold <= 1:
            raise ValueError("SEARCH_MODEL_SPAN_THRESHOLD must be greater than 0 and at most 1")
        self.model = AutoExtractor.from_pretrained(os.getenv("GLINER_MODEL", MODEL)).to(self.device)
        self.schema = self.model.create_schema().entities(FIELDS)
        classifier_model = os.getenv("SEARCH_CLASSIFIER_MODEL")
        self.classifier = AutoExtractor.from_pretrained(classifier_model).to(self.device) if classifier_model else self.model
        config_dir = os.environ["SEARCH_T5_CONFIG"]
        self.tokenizer = AutoTokenizer.from_pretrained(config_dir, local_files_only=True)
        config = AutoConfig.from_pretrained(config_dir, local_files_only=True)
        base = T5ForConditionalGeneration(config)
        with tarfile.open(os.environ["SEARCH_T5_CHECKPOINT"]) as archive:
            weights = torch.load(archive.extractfile("./model_weights.ckpt"), map_location="cpu", weights_only=True)
        base.load_state_dict({key.removeprefix("model."): value for key, value in weights.items()})
        self.money = PeftModel.from_pretrained(base, os.environ["SEARCH_T5_ADAPTER"]).to(self.device).eval()

    @torch.inference_mode()
    def extract(self, prompt, places=(), covered=()):
        raw = self.model.extract_long(prompt, self.schema, threshold=self.span_threshold, include_spans=True)["entities"]
        spans = {
            field: [
                {"text": s["text"], "start": s["start"], "end": s["end"]}
                for s in values
                if 0 <= s["start"] < s["end"] <= len(prompt) and s["text"] == prompt[s["start"]:s["end"]]
            ][:128]
            for field, values in raw.items()
            if values
        }
        written = [s for s in spans.get("rent", [])
                   if not WRITTEN_AMOUNT.fullmatch(s["text"]) and not re.search(r"%|\bpercent\b", s["text"], re.I)][:16]
        if written:
            inputs = self.tokenizer([amount_input(s["text"]) for s in written], padding=True, return_tensors="pt").to(self.device)
            output = self.money.generate(**inputs, max_new_tokens=24, do_sample=False)
            for span, value in zip(written, self.tokenizer.batch_decode(output, skip_special_tokens=True), strict=True):
                if NUMBER.fullmatch(value):
                    normalized = Decimal("".join(value.split()))
                    if 0 < normalized <= 100000:
                        span["value"] = float(normalized)
        trips = candidate_trips(prompt, spans, places)
        requests = {}

        def classify(text, target, name, labels, *, multi=False, choice_span=None):
            model = self.model
            if choice_span is not None and self.classifier is not self.model:
                model, text = self.classifier, choice_span
            pending = requests.setdefault(model, {})
            key = (id(target), text)
            if key not in pending:
                pending[key] = (text, model.create_schema(), target, {})
            _, schema, _, tasks = pending[key]
            schema.classification(name, labels, multi_label=multi, cls_threshold=0.55)
            tasks[name] = multi

        # Decisions see only their own evidence or clause, never the entire prompt's other stops.
        quantity_spans = sorted(
            (span for field in NUMBERS for span in spans.get(field, [])),
            key=lambda span: (span["start"], span["end"]),
        )
        for field in (*CHOICES, *BOOLEANS, *NUMBERS, "availableBy"):
            if field in covered:
                continue
            for span in spans.get(field, [])[:12]:
                prev = max((s["end"] for s in quantity_spans if s["end"] <= span["start"]), default=0)
                source = source_clause(prompt, span["start"], span["end"], max(prev, span["start"] - 60, 0))
                span["phrase"] = source["text"]
                subject = source["text"]
                if field in CHOICES:
                    classify(subject, span, "choice", CHOICES[field], multi=field == "unitTypes",
                             choice_span=span["text"] if field in DECIDE_CHOICES else None)
                if field in BOOLEANS:
                    classify(subject, span, "choice", BOOLEANS_CHOICE)
                if field in NUMBERS:
                    classify(subject, span, "bound", BOUNDS)
        for trip in trips:
            for mode in trip["modeSpans"]:
                classify(mode["text"], mode, "choice", MODES, choice_span=mode["text"])
            if trip["amenity"] and "category" not in trip:
                destination = trip["destination"]["text"]
                classify(destination, trip, "category", AMENITIES, choice_span=destination)
        for model, pending in requests.items():
            batch = list(pending.values())
            labels = model.batch_extract(
                [text for text, *_ in batch], [schema for _, schema, *_ in batch], batch_size=16, include_confidence=True
            )
            for (_, _, target, tasks), result in zip(batch, labels, strict=True):
                for name, multi in tasks.items():
                    prediction = result.get(name)
                    if multi:
                        target[name] = [choice["label"] for choice in prediction or []]
                    elif prediction and prediction["confidence"] >= 0.55:
                        target[name] = prediction["label"]
        return {
            "spans": {field: [inline_span(prompt, s) for s in items] for field, items in spans.items() if not field.startswith("trip")},
            "trips": [
                {**trip, "destination": inline_span(prompt, trip["destination"]), "source": inline_span(prompt, trip["source"]),
                 "duration": inline_span(prompt, trip["duration"]) if trip["duration"] else None,
                 "modeSpans": [inline_span(prompt, mode) for mode in trip["modeSpans"]]}
                for trip in trips
            ],
        }


def serve(extractor, host, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            # Do not log request data.
            return

        def setup(self):
            super().setup()
            self.request.settimeout(3)

        def respond(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except BrokenPipeError:
                pass

        def do_GET(self):
            self.respond(200 if self.path == "/health" else 404, {})

        def do_POST(self):
            if self.path != "/extract":
                self.respond(404, {})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 32768:
                    raise ValueError("Invalid body size")
                data = json.loads(self.rfile.read(length))
                prompt = data.get("prompt") if isinstance(data, dict) else None
                if not isinstance(prompt, str) or not prompt.strip() or utf16_offset(prompt, len(prompt)) > 4000:
                    raise ValueError("Invalid prompt")
            except (ValueError, TimeoutError):
                self.respond(422, {"error": "Invalid prompt"})
                return
            try:
                covered = data.get("covered")
                covered = {field for field in covered if isinstance(field, str)} if isinstance(covered, list) else set()
                result = extractor.extract(prompt, validated_places(prompt, data.get("places")), covered)
            except Exception as error:
                logging.error("Search extraction failed: %s", type(error).__name__)
                self.respond(503, {"error": "Extraction unavailable"})
                return
            self.respond(200, result)

    # A single inference at a time keeps CPU and memory use bounded on small hosts.
    with HTTPServer((host, port), Handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    serve(Extractor(), os.getenv("SEARCH_MODEL_HOST", "127.0.0.1"), int(os.getenv("SEARCH_MODEL_PORT", "8081")))
