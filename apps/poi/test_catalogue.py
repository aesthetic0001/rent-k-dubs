import unittest

import numpy as np

from catalogue import Catalogue


def place(id, name, aliases=(), street=""):
    return dict(id=id, name=name, aliases=aliases, category="grocery", subcategory="supermarket",
                lat=43.46, lng=-80.53, street=street, house_number="", city="")


class CatalogueTest(unittest.TestCase):
    def test_exact_mentions_and_branch_choices(self):
        places = [
            place("tt", "大統華 T&T Supermarket", ["T&T"]),
            place("uw", "University of Waterloo", ["UW"]),
            place("king", "Shoppers Drug Mart", ["Shoppers"], "King Street South"),
            place("bridgeport", "Shoppers Drug Mart", ["Shoppers"], "Bridgeport Road East"),
        ]
        places[-1]["lat"] += 0.01
        catalogue = Catalogue(places, lambda texts: np.ones((len(texts), 1)))
        prompt = "🏠 Near T&T, within 12 minutes biking to UW"
        self.assertEqual(catalogue.mentions(prompt), [
            {"text": "T&T", "start": 8, "end": 11},
            {"text": "UW", "start": 41, "end": 43},
        ])
        self.assertEqual(catalogue.resolve("T&T")["destination"]["id"], "tt")
        self.assertEqual(catalogue.resolve("Shoppers")["status"], "ambiguous")
        self.assertEqual(catalogue.mentions("near Shoppers on Bridgeport")[0]["text"], "Shoppers on Bridgeport")
        self.assertEqual(catalogue.resolve("Shoppers on Bridgeport")["destination"]["id"], "bridgeport")
        self.assertEqual(catalogue.resolve("T&T on Westmount")["choices"][0]["id"], "tt")
        hybrid = catalogue.resolve("Shoper on Bridgeport")
        self.assertEqual(hybrid["status"], "ambiguous")
        self.assertEqual(hybrid["choices"][0]["id"], "bridgeport")


if __name__ == "__main__":
    unittest.main()
