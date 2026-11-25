import unittest

from evaluate import IGNORED_WORDS, STREET_TYPES, boosts, build_fields, words


def place(name, street, number=""):
    return {"name": name, "aliases": [], "street": street, "house_number": number}


class FuzzyAgreementTest(unittest.TestCase):
    def test_name_and_street_outweigh_either_field(self):
        fields = build_fields([
            place("Sobeys", "Bridgeport Road East", "94"),
            place("Sobeys", "Parkside Drive"),
            place("Bulk Barn", "Bridgeport Road East", "75"),
            place("Sobeys", "Bridgeport Road West", "94"),
        ], words, STREET_TYPES, IGNORED_WORDS)

        def score(query):
            return boosts(query, fields, words, STREET_TYPES, IGNORED_WORDS)

        exact = score("Sobeys on Bridgeport Rd E")
        typo = score("Sobyes on Bridgeprt Rd E")
        self.assertGreater(exact[0], typo[0])
        self.assertGreater(typo[0], exact[1])
        self.assertGreater(exact[1], exact[2])
        self.assertEqual(exact[1], exact[3])
        self.assertAlmostEqual(score("Sobeys on 94 Bridgeport Rd E")[0], exact[0])
        self.assertNotIn(2, score("Sobeys on 94 Bridgeport Rd E"))

    def test_number_in_place_name_is_distinct_from_house_number(self):
        fields = build_fields([
            place("Medical Centre 2", "The Boardwalk", "435"),
            place("Medical Centre 2", "Another Street", "2"),
        ], words, STREET_TYPES, IGNORED_WORDS)
        scores = boosts("Medical Centre 2 at Boardwalk", fields, words, STREET_TYPES,
                        IGNORED_WORDS)
        self.assertGreater(scores[0], scores[1])
