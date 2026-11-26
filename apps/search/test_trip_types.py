import unittest

from server import candidate_trips


class TripTypeTest(unittest.TestCase):
    def test_catalogue_hints_and_generic_phrases_stay_distinct(self):
        prompt = "Near Waterloo Park, two minutes to the public library"
        def span(text):
            start = prompt.index(text)
            return {"start": start, "end": start + len(text), "text": text}

        trips = candidate_trips(prompt, {
            "area": [span("Waterloo Park")],
            "amenity": [span("Waterloo Park")],
            "destination": [span("public library")],
            "tripDuration": [span("two minutes")],
        }, [span("Waterloo Park")])
        self.assertEqual([(t["destination"]["text"], t["amenity"], t.get("category")) for t in trips], [
            ("Waterloo Park", False, None), ("public library", True, "library"),
        ])
        self.assertIsNone(trips[0]["duration"])
        self.assertEqual(trips[1]["duration"]["text"], "two minutes")

    def test_suffix_evidence_stays_with_its_destination(self):
        prompt = "Near T&T and within 12 minutes of UW by bike, and Kitchener GO in 30 minutes or less by transit"

        def span(text):
            start = prompt.index(text)
            return {"start": start, "end": start + len(text), "text": text}

        trips = candidate_trips(prompt, {
            "tripDuration": [span("12 minutes"), span("30 minutes")],
            "tripMode": [span("by bike"), span("by transit")],
        }, [span("T&T"), span("UW"), span("Kitchener GO")])
        self.assertEqual([
            (trip["duration"]["text"] if trip["duration"] else None, [mode["text"] for mode in trip["modeSpans"]])
            for trip in trips
        ], [(None, []), ("12 minutes", ["by bike"]), ("30 minutes", ["by transit"])])
        self.assertTrue(trips[-1]["source"]["text"].endswith("or less by transit"))

    def test_catalogue_code_inside_spoken_duration_does_not_steal_trip(self):
        prompt = "I'm after a bike ride of ten minutes or less to QNC."

        def span(text):
            start = prompt.index(text)
            return {"start": start, "end": start + len(text), "text": text}

        trips = candidate_trips(prompt, {
            "destination": [span("QNC")],
            "tripDuration": [span("ten minutes")],
            "tripMode": [span("bike ride")],
        }, [span("ten"), span("QNC")])
        self.assertEqual(len(trips), 1)
        self.assertEqual(trips[0]["destination"], span("QNC"))
        self.assertEqual(trips[0]["duration"], span("ten minutes"))
        self.assertEqual(trips[0]["modeSpans"], [span("bike ride")])

    def test_comma_before_optional_time_keeps_the_same_destination(self):
        prompt = "Close to Waterloo Park, ideally a twelve-minute walk."

        def span(text):
            start = prompt.index(text)
            return {"start": start, "end": start + len(text), "text": text}

        trips = candidate_trips(prompt, {
            "destination": [span("Waterloo Park")],
            "tripDuration": [span("twelve-minute")],
            "tripMode": [span("walk")],
        }, [])
        self.assertEqual(trips[0]["duration"], span("twelve-minute"))
        self.assertEqual(trips[0]["modeSpans"], [span("walk")])

    def test_alternative_mode_before_next_destination_stays_with_first_trip(self):
        prompt = "Max 18 minutes to Davis Centre by transit or by bike, then near the pharmacy."

        def span(text):
            start = prompt.index(text)
            return {"start": start, "end": start + len(text), "text": text}

        trips = candidate_trips(prompt, {
            "amenity": [span("pharmacy")],
            "tripDuration": [span("18 minutes")],
            "tripMode": [span("by transit")],
        }, [span("Davis Centre")])
        self.assertEqual(trips[0]["modeSpans"], [span("by transit"), span("by bike")])
        self.assertEqual(trips[1]["modeSpans"], [])

    def test_negative_wording_can_set_a_positive_travel_limit(self):
        prompt = "I don't want to be more than 10 minutes by bike from UW."

        def span(text):
            start = prompt.index(text)
            return {"start": start, "end": start + len(text), "text": text}

        trips = candidate_trips(prompt, {
            "tripDuration": [span("10 minutes")],
            "tripMode": [span("by bike")],
        }, [span("UW")])
        self.assertEqual(trips[0]["duration"], span("10 minutes"))

    def test_workplace_can_ground_an_explicit_trip_in_the_same_sentence(self):
        prompt = "I work at Riverside City Hall, and need a 24-minute bus trip at most."

        def span(text):
            start = prompt.index(text)
            return {"start": start, "end": start + len(text), "text": text}

        trips = candidate_trips(prompt, {
            "tripDuration": [span("24-minute")],
            "tripMode": [span("bus trip")],
        }, [])
        self.assertEqual([(trip["destination"], trip["duration"]) for trip in trips],
                         [(span("Riverside City Hall"), span("24-minute"))])
