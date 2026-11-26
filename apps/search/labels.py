"""Search labels shared by the extraction model and the optional Decide classifier."""

import re

MODES = {
    "walk": "walking or going on foot", "bike": "bicycling, cycling, or pedalling",
    "transit": "public transit, bus, train, ION or light rail", "drive": "driving or going by car",
}
AMENITIES = {
    "grocery": "grocery store or supermarket", "school": "primary or secondary school",
    "university": "university or college", "library": "public library", "park": "public park",
    "community_centre": "community or recreation centre", "pharmacy": "pharmacy or drugstore",
    "clinic": "medical or walk-in clinic", "rapid_transit": "rapid transit or light rail station",
}
GENERIC_AMENITIES = {
    "grocery": r"grocer(?:y stores?|ies)|supermarkets?",
    "school": r"(?:(?:public|elementary|primary|secondary|high|middle) )?schools?",
    "university": r"universit(?:y|ies)|colleges?",
    "library": r"(?:public )?librar(?:y|ies)",
    "park": r"(?:(?:public|playground) )?parks?|playgrounds?",
    "community_centre": r"(?:community|recreation) cent(?:re|er)s?",
    "pharmacy": r"pharmac(?:y|ies)|drugstores?",
    "clinic": r"(?:(?:medical|walk[- ]in) )?clinics?",
    "rapid_transit": r"(?:(?:rapid transit|light rail|ion|rail|train) )stations?|subway",
}


def generic_amenity(phrase):
    name = re.sub(r"^(?:(?:a|an|the|nearest|nearby|any)\s+)+", "", phrase.strip().lower())
    return next((key for key, pattern in GENERIC_AMENITIES.items() if re.fullmatch(pattern, name)), None)


SORTS = {
    "lowest_rent": "cheapest asking rent first", "newest": "most recently listed first",
    "best_value": "best rent relative to comparable listings", "shortest_trips": "shortest commutes first",
    "best_match": "best overall match",
}
CHOICES = {
    "leaseTerm": {"short_term": "short-term or sublet rental", "12_months": "year-long or twelve-month lease"},
    "unitTypes": {key: f"the renter explicitly accepts a {key}" for key in (
        "apartment", "condo", "basement", "house", "townhouse", "room", "studio"
    )},
    "airConditioning": {"any": "any air conditioning is acceptable", "central": "central air conditioning"},
    "petsAllowed": {"any": "pets allowed without a species restriction", "cats": "cats allowed", "dogs": "dogs allowed"},
    "buildingAge": {
        "min": "must be built after or since this year", "max": "must be built before this year",
        "exact": "must be built in this year",
    },
    "sort": SORTS,
}
BOOLEANS = ("furnished", "parking", "laundryInSuite", "utilitiesIncluded")
NUMBERS = ("rent", "bedrooms", "bathrooms", "sizeSqft")
DECIDE_CHOICES = {"leaseTerm", "unitTypes", "airConditioning", "petsAllowed", "sort"}
BOUNDS = {
    "min": "a lower bound, at least this amount", "max": "an upper bound, at most this amount",
    "exact": "exactly this quantity", "unspecified": "no stated relation to this number",
}
