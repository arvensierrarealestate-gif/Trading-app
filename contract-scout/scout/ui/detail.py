from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import db, deadlines, export, finance, pipeline, checklist, recommend, config
from ..models import OPP_STATUSES, VERIFIED, ASSUMED
from .common import get_conn, get_profile, BADGE, REC_BADGE, money

RESULT_ICON = {"MET": "✅", "NOT_MET": "❌", "UNKNOWN": "❓", "NOT_APPLICABLE": "➖"}


def render():
    conn = get_conn()
    opps = db.list_opportunities(conn)
    if not opps:
        st.title("Opportunity Detail")
        st.info("No opportunities yet. Upload one first.")
        return
    ids = [o["id"] for o in opps]
    try:
        qp = st.query_params.get("opp")
        if qp and int(qp) in ids:
            st.session_state.selected_opp = int(qp)
    except (TypeError, ValueError):
        pass
    default = st.session_state.get("selected_opp", ids[0])
    idx = ids.index(default) if default in ids else 0
    oid = st.selectbox("Opportunity", ids, index=idx, format_func=lambda i: f"#{i} · {next(o['title'] for o in opps if o['id'] == i)}")
    st.session_state.selected_opp = oid
    opp = db.get_opportunity(conn, oid)
    profile, _ = get_profile()

    st.title(opp["title"])
    st.caption("Contract Analysis: requirements, deadlines, scope, documents, restrictions, and the company-independent opportunity assessment.")
    if opp["is_sample"]:
        st.caption("SAMPLE RECORD - fictitious solicitation used for testing.")
    top = st.columns(4)
    top[0].metric("Qualification", f"{BADGE.get(opp['match_class'])} {opp['match_class'] or 'Not evaluated'}", f"score {opp['match_score'] or 0}")
    top[1].metric("Recommendation", f"{REC_BADGE.get(opp['recommendation'])} {opp['recommendation'] or '—'}")
    top[2].metric("Bid deadline", deadlines.format_local(opp["bid_deadline_utc"]), deadlines.urgency_bucket(opp["bid_deadline_utc"]))
    top[3].metric("Contract value", money(opp["value_high"] or opp["value_low"]), opp["value_status"])

    card = recommend.build_card(conn, oid, profile, config.DASHBOARD_URL)
    with st.container(border=True):
        st.markdown(f"### {card.get('potential') or 'Not analyzed'} opportunity potential · {card['commercial_score'] if card['commercial_score'] is not None else '—'}/100 · Recommendation: {card['recommendation']}")
        r1, r2, r3, r4 = st.columns(4)
        r1.metric("Entry barrier", (card.get("entry_barrier") or "unknown").title())
        r2.metric("Jurisdiction", card["jurisdiction"] or "Maryland")
        r3.metric("Subcontracting", "feasible" if card.get("subcontract_feasible") else "restricted / unknown")
        r4.metric("Business match", f"{card['recommended_entity'] or '—'}", card["entity_match"] or ("select a business" if not card.get("business_mode") else ""))
        if card.get("services"):
            st.markdown("**Services requested:** " + "; ".join(card["services"][:8]))
        if card.get("business_types"):
            st.markdown("**Business types that could perform this:** " + ", ".join(card["business_types"]))
        if card.get("promising"):
            st.markdown("**Why it looks promising:** " + " · ".join(card["promising"]))
        if card.get("barriers"):
            st.markdown("**Barriers to bidding:** " + " · ".join(card["barriers"]))
        if card.get("missing_info"):
            st.warning("Information gaps: " + ", ".join(card["missing_info"]) + ". The score cannot be high until these are known.")
        if card.get("business_mode"):
            if card["why_it_matches"]:
                st.markdown("**Why it fits the selected business:** " + " · ".join(card["why_it_matches"][:4]))
            if card["missing"]:
                st.markdown("**Missing or unverified for this business:** " + " · ".join(card["missing"][:6]))
            if card["partner_path"]:
                st.markdown("**Subcontractor / partner path:** " + " · ".join(card["partner_path"][:4]))
        if card["immediate_actions"]:
            st.markdown("**Do first:** " + " · ".join(card["immediate_actions"][:5]))
        with st.expander("How the opportunity score was built"):
            for pcs in card["commercial_parts"]:
                st.write(f"- **{pcs['component']}**: {pcs['points']} / {pcs['max']} — {pcs['why']}")
        q1, q2, q3, q4 = st.columns(4)
        def _set_status(new):
            db.update_opportunity(conn, oid, status=new)
            db.log(conn, "set_status", "opportunity", oid, {"status": new}, actor="user")
            conn.commit()
            st.rerun()
        if q1.button("Mark Under Review"):
            _set_status("Under Review")
        if q2.button("Mark Qualified"):
            _set_status("Qualified")
        if q3.button("Preparing Bid"):
            _set_status("Preparing Bid")
        if q4.button("Reject this one"):
            _set_status("Rejected")
        st.caption("Entity comparison and qualification reasons are on the tabs below. Nothing here submits a bid.")

    with st.expander("Facts and edits", expanded=False):
        c1, c2, c3 = st.columns(3)
        c1.write(f"**Number:** {opp['solicitation_number'] or 'Not found'}")
        c1.write(f"**Agency:** {opp['agency'] or 'Not found'}")
        c1.write(f"**Jurisdiction:** {opp['jurisdiction'] or 'Not found'}")
        c2.write(f"**Industry:** {opp['industry']}")
        c2.write(f"**Location:** {opp['location'] or 'Not found'}")
        c2.write(f"**Duration:** {opp['contract_duration'] or 'Not found'}")
        c2.write(f"**Set-aside:** {opp.get('set_aside') or 'not read'} · **Award basis:** {opp.get('award_basis') or 'not read'}")
        c3.write(f"**Source:** {opp['source_id']}")
        if opp["source_url"]:
            c3.markdown(f"[Source link]({opp['source_url']})")
        c3.write(f"**First seen:** {opp['first_seen'][:10]} · **Last seen:** {opp['last_seen'][:10]}")
        st.write(f"**Scope summary:** {opp['summary'] or 'Not found'}")
        st.caption(f"Value note: {opp['value_note'] or '—'}")
        with st.form("edit_opp"):
            e1, e2, e3 = st.columns(3)
            new_status = e1.selectbox("Bid status", OPP_STATUSES, index=OPP_STATUSES.index(opp["status"]) if opp["status"] in OPP_STATUSES else 0)
            new_deadline = e2.text_input("Correct the deadline (local time)", value=opp["bid_deadline_local"] or "")
            new_value = e3.text_input("Set contract value (your estimate)", value="" if opp["value_high"] is None else str(opp["value_high"]))
            notes = st.text_area("Notes", value=opp["notes"] or "")
            if st.form_submit_button("Save"):
                upd = {"status": new_status, "notes": notes}
                if new_deadline and new_deadline != (opp["bid_deadline_local"] or ""):
                    dt = deadlines.parse_deadline(new_deadline)
                    if dt:
                        u, l, tz = deadlines.to_storage(dt)
                        upd.update(bid_deadline_utc=u, bid_deadline_local=l, deadline_tz=tz, deadline_status="ASSUMED")
                    else:
                        st.error("Could not parse that deadline. Try 'December 4, 2026 2:00 PM'.")
                if new_value and new_value != str(opp["value_high"] or ""):
                    try:
                        v = float(new_value.replace("$", "").replace(",", ""))
                        upd.update(value_low=v, value_high=v, value_status=ASSUMED, value_note="User-entered estimate")
                    except ValueError:
                        st.error("Value must be a number.")
                db.update_opportunity(conn, oid, **upd)
                db.log(conn, "edit_opportunity", "opportunity", oid, upd, actor="user")
                conn.commit()
                st.success("Saved.")
                st.rerun()

    tabs = st.tabs(["Requirements (traceable)", "Business qualification checks", "Compare entities", "Cost & margin", "Documents & changes", "Partners", "Bid checklist", "General analysis"])

    with tabs[0]:
        reqs = db.list_requirements(conn, oid)
        if reqs:
            df = pd.DataFrame([{"Category": r["category"], "Mandatory": r["mandatory"], "Requirement": r["text"], "Value": r["value"],
                                "Document": r["document"], "Page/Section": r["page_ref"], "Quote": r["quote"], "Confidence": r["confidence"],
                                "Status": r["info_status"], "Extracted by": r["method"]} for r in reqs])
            st.dataframe(df, width="stretch", hide_index=True)
            st.download_button("Export requirements CSV", export.requirements_csv(conn, oid), f"requirements_{oid}.csv", "text/csv")
        else:
            st.info("No requirements extracted yet.")

    with tabs[1]:
        if profile is None:
            st.info("No business selected. Pick a Business Profile in the sidebar to run Strong / Conditional / Poor matching; the General analysis tab needs no business.")
        if st.button("Re-run analysis" + (" and business matching" if profile is not None else "")):
            res = pipeline.evaluate_opportunity(conn, oid, profile, actor="user", use_active_profile=False)
            conn.commit()
            st.success(f"{res['match_class'] or 'General analysis'} · {res['summary']}")
            st.rerun()
        ev = db.latest_evaluation(conn, oid) if (profile is not None and opp.get("match_class")) else None
        if ev:
            st.write(f"**{ev['match_class']}** (score {ev['score']}) evaluated {ev['created_at'][:16]} against profile `{ev['profile_version']}`. {ev['summary']}")
            st.caption("Why: only VERIFIED profile facts satisfy a rule. UNKNOWN on any mandatory rule blocks Strong Match. Owner or affiliate experience never counts as entity experience.")
            for c in ev["checks"]:
                if not c["mandatory"] and c["result"] == "NOT_APPLICABLE":
                    continue
                with st.container(border=True):
                    st.write(f"{RESULT_ICON.get(c['result'], '?')} **{c['result']}** · {c['category']} · {'mandatory' if c['mandatory'] else 'optional'}"
                             + (f" · {c['document']} {c['page_ref']}" if c.get("page_ref") else ""))
                    st.write(c["requirement"])
                    st.caption(f"{c['explanation']} Profile fact status: {c['profile_fact_status']}.")
                    if c.get("remedy"):
                        st.write(f"→ To fix: {c['remedy']}" + (" (a subcontract/JV partner could cover this)" if c.get("partner_path") else ""))
        else:
            st.info("Not evaluated yet.")

    with tabs[2]:
        st.caption("The same solicitation scored against every entity profile on file. Nothing is saved; use the sidebar to switch the active entity.")
        st.info("Read 'Unknown' as homework, not a pass. An entity with no verified facts can never do better than Conditional, "
                "while a real entity can be Poor because a verified fact (an insurance limit, a formation date) falls short of the rule.", icon="ℹ️")
        rows = sorted(pipeline.compare_entities(conn, oid), key=lambda r: (r["not_met"], -r["met"], r["unknown"]))
        if rows:
            st.dataframe(pd.DataFrame([{"Entity": r["entity"], "Qualification": f"{BADGE.get(r['match_class'])} {r['match_class']}", "Score": r["score"],
                                        "Met": r["met"], "Unknown": r["unknown"], "Not met": r["not_met"], "Legally eligible": r["legally_eligible"],
                                        "Partner path": r["partner_feasible"], "Top gap": r["top_gap"]} for r in rows]), width="stretch", hide_index=True)
        else:
            st.info("No entity profiles found in profiles/ or data/profiles/.")

    with tabs[3]:
        est = db.latest_cost_estimate(conn, oid)
        assumptions = est["assumptions"] if est else finance.default_assumptions(pipeline.contract_value_of(opp), opp["value_status"], opp=opp)
        from ..wages import wage_floor, RESEARCHED_ON
        wf = wage_floor(opp.get("jurisdiction"), opp.get("location"), opp.get("agency"), "construction" if (opp.get("industry") or "").startswith("Construction") else "service")
        st.info(f"Wage floor for this location: ${wf['rate']:.2f}/hour ({wf['basis']}; researched {RESEARCHED_ON}). {wf['note']}", icon="💵")
        st.caption("Every number below is an editable assumption (ASSUMED) unless marked VERIFIED. Nothing is inferred from the solicitation except a published value.")
        with st.form("cost"):
            new_a = {}
            cols = st.columns(3)
            for i, (k, a) in enumerate(assumptions.items()):
                with cols[i % 3]:
                    val = a.get("value")
                    label = f"{k.replace('_', ' ')} ({a.get('unit', '')}) [{a.get('status')}]"
                    nv = st.number_input(label, value=float(val) if val is not None else 0.0, help=a.get("note", ""), key=f"a_{k}")
                    new_a[k] = dict(a, value=(None if (k == "contract_revenue" and nv == 0) else nv))
            if new_a["contract_revenue"]["value"] is not None and new_a["contract_revenue"]["value"] != assumptions["contract_revenue"].get("value"):
                new_a["contract_revenue"]["status"] = ASSUMED
            if st.form_submit_button("Recalculate and save"):
                out = pipeline.save_estimate(conn, oid, new_a, actor="user")
                conn.commit()
                st.success(f"Recommendation: {out['recommendation']} · " + " ".join(out["reasons"]))
                st.rerun()
        if est:
            r = est["results"]
            k = st.columns(4)
            k[0].metric("Revenue", money(r["revenue"]), r["revenue_status"])
            k[1].metric("Total cost (base)", money(r["total_cost_base"]), f"{money(r['total_cost_low'])} – {money(r['total_cost_high'])}")
            k[2].metric("Gross margin", f"{r['gross_margin_pct']}%" if r["gross_margin_pct"] is not None else "n/a",
                        f"{r.get('gross_margin_low_pct')}% to {r.get('gross_margin_high_pct')}%" if r["gross_margin_pct"] is not None else "needs revenue")
            k[3].metric("Working capital needed", money(r["working_capital_needed"]), f"burn {money(r['monthly_burn'])}/mo")
            st.write(f"Labor {money(r['labor_cost'])} · Bond premium {money(r['bond_cost'])} · Overhead {money(r['overhead'])} · Contingency {money(r['contingency'])} · Retainage held {money(r['retainage_held'])}")
            st.write(f"**Recommendation: {est['recommendation']}**")
        else:
            st.info("No estimate saved yet. Enter assumptions above.")

    with tabs[4]:
        docs = db.list_documents(conn, oid)
        if docs:
            st.dataframe(pd.DataFrame([{"File": d["filename"], "Type": d["doc_type"], "Pages": d["page_count"], "Retrieved": d["retrieved_at"][:16],
                                        "Extraction": d["extraction_method"], "SHA-256": d["sha256"][:16], "URL": d["source_url"]} for d in docs]), width="stretch", hide_index=True)
        ch = db.list_change_events(conn, oid)
        if ch:
            st.subheader("Detected changes / amendments")
            st.dataframe(pd.DataFrame([{"When": c["detected_at"][:16], "Field": c["field"], "Old": c["old_value"], "New": c["new_value"], "Acknowledged": bool(c["acknowledged"])} for c in ch]), width="stretch", hide_index=True)
            if st.button("Acknowledge all changes"):
                db.acknowledge_changes(conn, oid)
                conn.commit()
                st.rerun()
        else:
            st.caption("No amendments detected for this opportunity.")

    with tabs[5]:
        ev = db.latest_evaluation(conn, oid)
        gaps = [c for c in (ev["checks"] if ev else []) if c.get("partner_path") and c["result"] in ("NOT_MET", "UNKNOWN")]
        if gaps:
            st.write("Gaps a subcontract, supplier or joint-venture partner could cover:")
            for g in gaps:
                st.write(f"- {g['category']}: {g['requirement'][:120]}")
            st.caption("Even as a subcontractor you still need: your own insurance at the prime's required limits, applicable trade licenses, "
                       "SDAT good standing, and often SBR/MBE paperwork if the prime counts you toward a goal.")
        parts = db.list_partners(conn, oid)
        if parts:
            st.dataframe(pd.DataFrame([{"Name": p["name"], "Role": p["role"], "Industry": p["industry"], "Contact": p["contact"], "Notes": p["notes"], "Link": p["source_url"]} for p in parts]), width="stretch", hide_index=True)
        with st.form("add_partner"):
            st.write("Add a partner lead for this opportunity")
            n = st.text_input("Name")
            role = st.selectbox("Role", ["prime contractor", "subcontractor", "supplier", "joint venture", "mentor-protégé"])
            ind = st.text_input("Industry", value=opp["industry"] or "")
            contact = st.text_input("Contact")
            url = st.text_input("Source URL")
            note = st.text_area("Notes")
            if st.form_submit_button("Add") and n:
                db.add_partner(conn, n, role, ind, contact, url, note, oid)
                db.log(conn, "add_partner", "partner", n, {"opportunity_id": oid}, actor="user")
                conn.commit()
                st.rerun()

    with tabs[6]:
        st.caption("Built from the standard Maryland forms, the submission items the reader found (with page references), and your open qualification gaps. "
                   "Tick items as you complete them; ticks are saved. The solicitation's own attachment table always controls.")
        c1, c2 = st.columns([1, 3])
        if c1.button("Build / refresh checklist"):
            ev = db.latest_evaluation(conn, oid)
            items = checklist.build_items(opp, db.list_requirements(conn, oid), ev)
            n = checklist.sync(conn, oid, items)
            db.log(conn, "build_checklist", "opportunity", oid, {"items": n}, actor="user")
            conn.commit()
            st.rerun()
        rows = db.list_checklist(conn, oid)
        if not rows:
            st.info("No checklist yet. Click Build / refresh checklist.")
        else:
            done = sum(1 for r in rows if r["done"])
            st.progress(done / len(rows), text=f"{done} of {len(rows)} items done")
            for stage in checklist.STAGES:
                group = [r for r in rows if r["stage"] == stage]
                if not group:
                    continue
                st.markdown(f"**{checklist.STAGE_LABELS[stage]}**")
                for r in group:
                    val = st.checkbox(f"{r['text']}  \n:gray[{r['source']}{(' · ' + r['note']) if r.get('note') else ''}]", value=r["done"], key=f"ck_{r['id']}")
                    if val != r["done"]:
                        db.set_checklist_done(conn, r["id"], val)
                        conn.commit()
            st.download_button("Download checklist (Markdown)", checklist.as_markdown(opp, rows), f"bid_checklist_{oid}.md", "text/markdown")
            if c2.button("Clear and rebuild from scratch"):
                db.clear_checklist(conn, oid)
                conn.commit()
                st.rerun()

    with tabs[7]:
        st.caption("Company-independent analysis of this contract: the ten entry-barrier questions, each with evidence from the documents.")
        for a in card.get("barrier_answers", []):
            icon = {"low": "🟢", "medium": "🟡", "high": "🔴", "unknown": "⚪"}.get(a["barrier"], "⚪")
            st.write(f"{icon} **{a['question']}** {a['answer']}  \n:gray[evidence: {a['evidence']}{(' · ' + a['note']) if a.get('note') else ''}]")
        st.write(f"**Set-aside:** {card.get('set_aside') or 'none stated'} · **Award basis:** {card.get('award_basis') or 'not stated'}")
        if card.get("financial"):
            f = card["financial"]
            st.write(f"**Financial reliability:** {f.get('reliability_note')}")
            if f.get("scenarios") and f["scenarios"].get("base", {}).get("margin_pct") is not None:
                st.write(f"Scenarios: conservative {f['scenarios']['conservative'].get('margin_pct')}% · base {f['scenarios']['base'].get('margin_pct')}% · optimistic {f['scenarios']['optimistic'].get('margin_pct')}%")
