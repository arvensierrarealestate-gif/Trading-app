"""Cost, Margin and Working Capital Estimator.

All inputs are labelled assumptions the user can edit. The estimator never
invents a contract value: when none is published, revenue stays MISSING and the
recommendation cannot be 'Pursue'.
"""
from __future__ import annotations

from typing import Any, Optional

from .models import ASSUMED, VERIFIED, MISSING, PURSUE, INVESTIGATE, REJECT, STRONG, CONDITIONAL, POOR

DEFAULT_ASSUMPTIONS: dict[str, dict[str, Any]] = {
    # key: {value, status, unit, note}
    "contract_revenue": {"value": None, "status": MISSING, "unit": "$", "note": "Published value, or your bid price. Required before 'Pursue'."},
    "duration_months": {"value": 12, "status": ASSUMED, "unit": "months", "note": "Performance period used for cash-flow math."},
    "labor_hours": {"value": 0, "status": ASSUMED, "unit": "hours", "note": "Total direct labor hours over the contract."},
    "labor_rate": {"value": 28.0, "status": ASSUMED, "unit": "$/hour", "note": "Base wage. Check prevailing/living wage rules in the solicitation."},
    "labor_burden_pct": {"value": 25.0, "status": ASSUMED, "unit": "%", "note": "Payroll taxes, workers' comp, benefits as % of wages."},
    "materials": {"value": 0, "status": ASSUMED, "unit": "$", "note": "Materials, supplies, consumables."},
    "equipment": {"value": 0, "status": ASSUMED, "unit": "$", "note": "Rentals, purchases, fuel, maintenance."},
    "subcontractors": {"value": 0, "status": ASSUMED, "unit": "$", "note": "Quotes from subs for trades you do not self-perform."},
    "transportation": {"value": 0, "status": ASSUMED, "unit": "$", "note": "Vehicles, mileage, deliveries."},
    "insurance_incremental": {"value": 0, "status": ASSUMED, "unit": "$", "note": "Extra premium needed to meet required limits."},
    "bond_rate_pct": {"value": 2.0, "status": ASSUMED, "unit": "% of contract", "note": "Performance & payment bond premium. 0 if no bond."},
    "permits_fees": {"value": 0, "status": ASSUMED, "unit": "$", "note": "Permits, licenses, certifications specific to this job."},
    "overhead_pct": {"value": 10.0, "status": ASSUMED, "unit": "% of direct cost", "note": "Office, admin, software, management time."},
    "contingency_pct": {"value": 5.0, "status": ASSUMED, "unit": "% of direct cost", "note": "Unknowns and risk items (liquidated damages, delays)."},
    "payment_lag_days": {"value": 45, "status": ASSUMED, "unit": "days", "note": "Days from invoice to payment. Maryland agencies often 30 to 60."},
    "mobilization": {"value": 0, "status": ASSUMED, "unit": "$", "note": "Upfront cash before the first invoice (deposits, hiring, equipment)."},
    "retainage_pct": {"value": 0.0, "status": ASSUMED, "unit": "%", "note": "Held back by the agency until completion, if stated."},
    "min_margin_pct": {"value": 15.0, "status": ASSUMED, "unit": "%", "note": "Your minimum acceptable gross margin to recommend Pursue."},
    "range_pct": {"value": 15.0, "status": ASSUMED, "unit": "%", "note": "Low/high cost sensitivity band."},
}


def default_assumptions(contract_value: Optional[float] = None, value_status: str = MISSING, bond_required: bool = True, opp: Optional[dict] = None) -> dict:
    a = {k: dict(v) for k, v in DEFAULT_ASSUMPTIONS.items()}
    if opp:
        from .wages import wage_floor
        ctype = "construction" if (opp.get("industry") or "").startswith("Construction") else "service"
        wf = wage_floor(opp.get("jurisdiction"), opp.get("location"), opp.get("agency"), ctype)
        # start labor at the legal floor plus a modest premium; the solicitation's wage determination controls
        a["labor_rate"]["value"] = round(wf["rate"] * 1.15, 2)
        a["labor_rate"]["note"] = f"Seeded from {wf['basis']} ${wf['rate']:.2f}/h plus 15% ({wf['source']}). {wf['note']}"
    if contract_value is not None:
        a["contract_revenue"]["value"] = float(contract_value)
        a["contract_revenue"]["status"] = value_status if value_status in (VERIFIED, ASSUMED) else ASSUMED
    if not bond_required:
        a["bond_rate_pct"]["value"] = 0.0
    return a


def _v(a: dict, key: str, default: float = 0.0) -> float:
    try:
        val = a.get(key, {}).get("value")
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def estimate(assumptions: dict) -> dict:
    """Compute base/low/high cost, gross profit, margin and working-capital need."""
    a = assumptions
    revenue = a.get("contract_revenue", {}).get("value")
    revenue_status = a.get("contract_revenue", {}).get("status", MISSING)
    rev = float(revenue) if revenue not in (None, "") else None

    labor = _v(a, "labor_hours") * _v(a, "labor_rate") * (1 + _v(a, "labor_burden_pct") / 100.0)
    bond = (rev or 0.0) * _v(a, "bond_rate_pct") / 100.0
    direct = labor + _v(a, "materials") + _v(a, "equipment") + _v(a, "subcontractors") + _v(a, "transportation") \
        + _v(a, "insurance_incremental") + bond + _v(a, "permits_fees")
    overhead = direct * _v(a, "overhead_pct") / 100.0
    contingency = direct * _v(a, "contingency_pct") / 100.0
    total = direct + overhead + contingency
    band = _v(a, "range_pct", 15.0) / 100.0
    low_cost, high_cost = total * (1 - band), total * (1 + band)

    months = max(_v(a, "duration_months", 12.0), 1.0)
    monthly_burn = total / months
    lag_months = _v(a, "payment_lag_days", 45.0) / 30.0
    retainage = (rev or 0.0) * _v(a, "retainage_pct") / 100.0
    working_capital = monthly_burn * lag_months + _v(a, "mobilization") + retainage

    out: dict[str, Any] = {
        "revenue": rev,
        "revenue_status": revenue_status,
        "labor_cost": round(labor, 2),
        "bond_cost": round(bond, 2),
        "direct_cost": round(direct, 2),
        "overhead": round(overhead, 2),
        "contingency": round(contingency, 2),
        "total_cost_base": round(total, 2),
        "total_cost_low": round(low_cost, 2),
        "total_cost_high": round(high_cost, 2),
        "monthly_burn": round(monthly_burn, 2),
        "working_capital_needed": round(working_capital, 2),
        "retainage_held": round(retainage, 2),
        "inputs_all_assumed": all(v.get("status") != VERIFIED for k, v in a.items() if k != "contract_revenue"),
        "scenarios": {"conservative": {"cost": round(high_cost, 2)}, "base": {"cost": round(total, 2)}, "optimistic": {"cost": round(low_cost, 2)}},
        "reliable": rev is not None and rev > 0 and total > 0,
        "reliability_note": ("Published value and cost assumptions present" if (rev and total > 0 and revenue_status == VERIFIED)
                             else "Revenue is an assumption" if (rev and total > 0) else "Revenue or cost inputs missing: profitability not assessable"),
    }
    if rev is not None and rev > 0:
        gp = rev - total
        for name, cost in (("conservative", high_cost), ("base", total), ("optimistic", low_cost)):
            out["scenarios"][name].update({"gross_profit": round(rev - cost, 2), "margin_pct": round(100.0 * (rev - cost) / rev, 1)})
        out.update({
            "gross_profit_base": round(gp, 2),
            "gross_profit_low": round(rev - high_cost, 2),
            "gross_profit_high": round(rev - low_cost, 2),
            "gross_margin_pct": round(100.0 * gp / rev, 1),
            "gross_margin_low_pct": round(100.0 * (rev - high_cost) / rev, 1),
            "gross_margin_high_pct": round(100.0 * (rev - low_cost) / rev, 1),
        })
    else:
        out.update({"gross_profit_base": None, "gross_margin_pct": None, "gross_profit_low": None, "gross_profit_high": None,
                    "gross_margin_low_pct": None, "gross_margin_high_pct": None})
    return out


def recommend(match_class: Optional[str], results: dict, assumptions: dict, legally_eligible: bool = True) -> tuple[str, list[str]]:
    """Combine eligibility class and financial result into Pursue / Investigate / Reject with reasons."""
    reasons: list[str] = []
    min_margin = _v(assumptions, "min_margin_pct", 15.0)
    margin = results.get("gross_margin_pct")
    if not legally_eligible:
        reasons.append("Entity is not legally eligible to bid as prime under a stated requirement.")
        return REJECT, reasons
    if match_class == POOR:
        reasons.append("Poor Match: a mandatory requirement is not met.")
        return REJECT, reasons
    if results.get("revenue") is None:
        reasons.append("No contract value available; profitability cannot be assessed.")
        return INVESTIGATE, reasons
    if results.get("total_cost_base", 0) <= 0:
        reasons.append("No cost assumptions entered yet; estimate is empty.")
        return INVESTIGATE, reasons
    if margin is not None and results.get("gross_margin_low_pct", -999) < 0:
        reasons.append(f"Margin turns negative at the high-cost case ({results.get('gross_margin_low_pct')}%).")
        if margin < min_margin:
            return REJECT, reasons + [f"Base margin {margin}% is below your {min_margin:g}% floor."]
    if margin is not None and margin < min_margin:
        reasons.append(f"Base margin {margin}% is below your {min_margin:g}% floor.")
        return REJECT if margin < 0 else INVESTIGATE, reasons
    if results.get("revenue_status") != VERIFIED:
        reasons.append("Revenue figure is an assumption, not a published value.")
    if match_class == CONDITIONAL:
        reasons.append("Conditional Match: unresolved requirements must be cleared before bidding.")
        return INVESTIGATE, reasons
    if match_class == STRONG and results.get("revenue_status") == VERIFIED:
        reasons.append(f"Strong Match and base margin {margin}% meets the {min_margin:g}% floor.")
        return PURSUE, reasons
    reasons.append("Eligibility not yet evaluated or revenue not verified.")
    return INVESTIGATE, reasons
