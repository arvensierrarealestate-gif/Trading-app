"""Wage floors for labor-rate assumptions (researched 2026-11-06; every figure carries its source and must be re-verified yearly).

These seed the cost estimator so labor never starts below the legal floor for the place of performance.
They are ASSUMED inputs: the solicitation's own wage determination always controls.
"""
from __future__ import annotations

from typing import Optional

RESEARCHED_ON = "2026-11-06"

# Maryland Living Wage for State service contracts (labor.maryland.gov/labor/prev/livingoverview.shtml)
MD_LIVING_WAGE_TIER1 = 17.54          # effective 2026-09-29, Tier 1 areas except Montgomery County
MD_LIVING_WAGE_TIER2 = 15.00          # all other counties (= State minimum wage)
MD_TIER1_COUNTIES = ("anne arundel", "baltimore city", "baltimore county", "howard", "montgomery", "prince george's", "prince georges")
MD_MINIMUM_WAGE = 15.00               # 2026, no scheduled increase
MONTGOMERY_MIN_LARGE = 18.00          # 51+ employees, effective 2026-07-01; mid/small tiers conflict across sources: verify
PG_COUNTY_LIVING_WAGE = 17.70         # Prince George's County contracts (Bloomberg Tax report); verify with county
DC_LIVING_WAGE = 18.40                # DC Living Wage Act and minimum wage, effective 2026-07-01 (DOES notice)

SOURCES = {
    "md_living": "Maryland Dept. of Labor, Living Wage for State Service Contracts overview and 2026 notice to employees",
    "md_min": "Maryland minimum wage 2026 ($15.00)",
    "moco": "Montgomery County minimum wage notice, July 1 2026 (large employers $18.00)",
    "pg": "Prince George's County living wage $17.70 (Bloomberg Tax); confirm with county solicitation",
    "dc": "DC DOES 2026 Notice of Living Wage Increase ($18.40 from July 1 2026)",
}


CITY_TO_COUNTY = {
    "rockville": "montgomery", "silver spring": "montgomery", "bethesda": "montgomery", "gaithersburg": "montgomery", "germantown": "montgomery",
    "wheaton": "montgomery", "takoma park": "montgomery", "largo": "prince george's", "upper marlboro": "prince george's", "hyattsville": "prince george's",
    "bowie": "prince george's", "laurel": "prince george's", "college park": "prince george's", "greenbelt": "prince george's", "landover": "prince george's",
    "towson": "baltimore county", "catonsville": "baltimore county", "dundalk": "baltimore county", "owings mills": "baltimore county", "essex": "baltimore county",
    "columbia": "howard", "ellicott city": "howard", "annapolis": "anne arundel", "glen burnie": "anne arundel", "baltimore, md": "baltimore city", "baltimore city": "baltimore city",
}


def wage_floor(jurisdiction: Optional[str], location: Optional[str], agency: Optional[str] = None, contract_type: str = "service") -> dict:
    """Return {rate, basis, source, note}. Construction work under prevailing wage is flagged, not priced."""
    loc = f"{location or ''} {agency or ''}".lower()
    for city, county in CITY_TO_COUNTY.items():
        if city in loc:
            loc += f" {county}"
            break
    jur = (jurisdiction or "Maryland").lower()
    if "washington, dc" in jur or " dc" in f" {jur}":
        return {"rate": DC_LIVING_WAGE, "basis": "DC Living Wage / minimum wage", "source": SOURCES["dc"],
                "note": "Applies to DC contracts and assistance of $100,000+; also the DC minimum wage"}
    if contract_type == "construction":
        return {"rate": MD_LIVING_WAGE_TIER1 if any(c in loc for c in MD_TIER1_COUNTIES) else MD_MINIMUM_WAGE,
                "basis": "Floor only; prevailing wage likely applies", "source": SOURCES["md_living"],
                "note": "Public construction over the statutory threshold uses Maryland prevailing wage rates by trade and county; get the wage determination from the solicitation"}
    if "montgomery" in loc:
        return {"rate": MONTGOMERY_MIN_LARGE, "basis": "Montgomery County minimum wage (large employer)", "source": SOURCES["moco"],
                "note": "Use the county rate that matches your employer size; the State living wage also applies on State contracts"}
    if "prince george" in loc:
        return {"rate": max(PG_COUNTY_LIVING_WAGE, MD_LIVING_WAGE_TIER1), "basis": "Higher of PG County living wage and MD Tier 1", "source": SOURCES["pg"],
                "note": "County contracts use the county living wage; State contracts in PG use Tier 1"}
    if any(c in loc for c in MD_TIER1_COUNTIES):
        return {"rate": MD_LIVING_WAGE_TIER1, "basis": "Maryland Living Wage Tier 1", "source": SOURCES["md_living"],
                "note": "Tier is set by where 50%+ of the services are performed"}
    return {"rate": MD_LIVING_WAGE_TIER2, "basis": "Maryland Living Wage Tier 2 / State minimum", "source": SOURCES["md_min"],
            "note": "Location not recognised as Tier 1; verify the tier from the solicitation"}
