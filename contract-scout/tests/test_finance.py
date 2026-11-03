from scout import finance
from scout.models import PURSUE, INVESTIGATE, REJECT, STRONG, CONDITIONAL, POOR, VERIFIED, MISSING


def _assump(revenue=None, status=VERIFIED, **over):
    a = finance.default_assumptions(revenue, status)
    for k, v in over.items():
        a[k]["value"] = v
    return a


def test_estimate_math():
    a = _assump(100000, labor_hours=1000, labor_rate=20, labor_burden_pct=25, materials=10000, bond_rate_pct=2, overhead_pct=10, contingency_pct=5,
                duration_months=10, payment_lag_days=60, mobilization=5000, retainage_pct=0)
    r = finance.estimate(a)
    assert r["labor_cost"] == 25000
    assert r["bond_cost"] == 2000
    assert r["direct_cost"] == 37000
    assert r["total_cost_base"] == round(37000 * 1.15, 2)
    assert r["gross_profit_base"] == round(100000 - 42550, 2)
    assert r["gross_margin_pct"] == 57.5
    assert r["working_capital_needed"] == round(4255 * 2 + 5000, 2)
    assert r["total_cost_low"] < r["total_cost_base"] < r["total_cost_high"]


def test_no_revenue_means_investigate_not_pursue():
    a = _assump(None, MISSING, labor_hours=100)
    r = finance.estimate(a)
    assert r["gross_margin_pct"] is None
    rec, reasons = finance.recommend(STRONG, r, a)
    assert rec == INVESTIGATE and "No contract value" in reasons[0]


def test_poor_match_rejects_even_if_profitable():
    a = _assump(100000, labor_hours=100)
    rec, _ = finance.recommend(POOR, finance.estimate(a), a)
    assert rec == REJECT


def test_strong_verified_and_margin_pursues():
    a = _assump(100000, VERIFIED, labor_hours=1000, labor_rate=20)
    rec, _ = finance.recommend(STRONG, finance.estimate(a), a)
    assert rec == PURSUE


def test_assumed_revenue_cannot_pursue():
    a = _assump(100000, "ASSUMED", labor_hours=1000, labor_rate=20)
    rec, reasons = finance.recommend(STRONG, finance.estimate(a), a)
    assert rec == INVESTIGATE and any("assumption" in r for r in reasons)


def test_low_margin_rejects():
    a = _assump(100000, VERIFIED, labor_hours=4000, labor_rate=25)  # cost > revenue
    rec, _ = finance.recommend(STRONG, finance.estimate(a), a)
    assert rec == REJECT


def test_conditional_match_investigates():
    a = _assump(100000, VERIFIED, labor_hours=1000, labor_rate=20)
    rec, _ = finance.recommend(CONDITIONAL, finance.estimate(a), a)
    assert rec == INVESTIGATE


def test_not_legally_eligible_rejects():
    a = _assump(100000, VERIFIED, labor_hours=10)
    rec, _ = finance.recommend(STRONG, finance.estimate(a), a, legally_eligible=False)
    assert rec == REJECT
