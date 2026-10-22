# UrPick Cat Cave landing page — implementation notes

Route: `/products/cozy-cat-cave` on the `urpick` Vercel project (live domain https://trading-app-3k96.vercel.app/products/cozy-cat-cave). Mirror: `/urpick/products/cozy-cat-cave` on the Trading-app Next.js deployment.

## A. Implementation summary

**What the project is.** Inspection of the repository showed two things living side by side: a Next.js 16 / React 19 / TypeScript app at the repo root (the trading app, `src/`, Supabase), and the UrPick site in `landing-pages/urpick-site/`, which is a static single-page storefront front end (plain HTML/CSS/JS, no framework) built by `tools/build.py` into `site/` and deployed by the `urpick` Vercel project with `framework: null` and `cleanUrls: true`. The UrPick site has a local-storage cart and a placeholder checkout; Shopify is not connected. No analytics or pixels existed. Brand tokens are CSS custom properties (cream, sand, ink, taupe, sage, sage-deep, clay) with Fraunces display and Inter body.

**What was built.** A product landing-page system inside the UrPick static site, not a rewrite of either app:

- `landing/template.html` — the reusable page (markup, styles, behaviour). One file, shared by every product.
- `landing/cozy-cat-cave.json` — the Cat Cave configuration: identity, status, price (null), variants, highlights, specs (null = "to be confirmed"), shipping/returns drafts, media slots, five campaign angles, CTA test copy, benefits, introduction guide, FAQ, analytics IDs (empty) and the missing-information list.
- `tools/build.py` — now renders every `landing/*.json` through the template to `site/products/<slug>/index.html`, and to `public/urpick/products/<slug>/index.html` with the `/urpick` base path for the mirror.
- `tools/test_landing.py` — 92 Playwright checks (desktop, tablet, phone).
- The existing homepage, pages, cart and popup are untouched; the main suite (`tools/test_nav.py`, 359 checks) still passes.

**Adding another product** = add `landing/<slug>.json` and run the build. The template stays shared.

## B. Page architecture (simplified 22 Oct 2026)

```
site/products/cozy-cat-cave/index.html   (generated from landing/template.html + landing/cozy-cat-cave.json)
├─ header        brand + "Shop the Cat Cave" (anchors to #buy); no site navigation
├─ status bar    shown while status != "live"
├─ 1 #hero       angle-driven eyebrow / headline / sub + price state + CTA + "Watch Bruce's Story"; the angle's ad video inline (poster, click-to-play, AI-concept tag; Ad 01 carries a one-line white-cave caption)
├─ 2 #buy        gallery (featured image + six labelled thumbnails + lightbox with prev/next/close/keyboard/swipe) beside the compact purchase module (name, Cow Print Edition, price state, 3 highlights, confirmed design, quantity, Add to cart, shipping/returns summary, expandable Dimensions & fit and Materials & care, waitlist in preview)
├─ 3 #upsell     "Make It Two Cozy Corners." one vs two, radio cards, sets the quantity; action disabled until price/bundle are configured
├─ 4 #why        three benefit cards + seven-question FAQ (fit, use, introduce, clean, shape, shipping, returns)
├─ 5 #final      closing headline + CTA to #buy
├─ footer        draft policies, privacy, terms, socials, support email, home
├─ sticky bar    phones/tablets only, once the purchase module has scrolled out of view; body padding so it covers nothing
└─ lightbox      role=dialog, focus managed, Escape / arrows / swipe
```

Gallery, purchase module, upsell, benefits and FAQ are identical for every angle; only hero copy and the video change.

## C. Conversion rationale

| Section | Job in the sequence | How it earns its place |
|---|---|---|
| Hero | Attention → first promise | Headline matches the ad hook (per `?angle`), product named in the eyebrow/visual, price state and three verifiable highlights, one primary CTA, video as the secondary action. |
| Problem | Recognition | Relatable, light, explicitly "not every cat". Ends by introducing a dedicated spot. |
| Product | Desired outcome → product | Plain description of what the cave is; six views, no vague claims. |
| Benefits | Why it may be worth it | Benefit-first, each tied to a feature; cushion and care benefits flagged as pending confirmation. |
| Demonstration | Perceived likelihood | Exterior → entrance → interior → approach → fit. Concept footage is disclosed as such. |
| Objections | Removes doubt | The five researched objections, each answered honestly; specs table shows "to be confirmed" rather than numbers. |
| Purchase | Effort and sacrifice | Real module (variants, quantity, stock, add to cart, shipping and returns beside the button). Preview state is labelled and offers a waitlist instead of a fake checkout. |
| Confidence | Trust | Everything we can tell you today, including that there are no reviews yet. |
| Offer | Value framing | One clear price once approved; bundles and bonuses appear only when real. |
| Final CTA | Purchase | Repeats the ask and routes straight to #buy, never to the homepage. |

Hormozi's value equation is applied as a lens: dream outcome (a spot that is theirs, a bed you do not hide) in hero and benefits; perceived likelihood through demonstration, dimensions and honest FAQ; time delay through the shipping draft beside the button; effort through clear sizing, care and a single CTA. No behaviour guarantee anywhere.

## D. Ad-to-page mapping

| Format | Ad | Landing URL | Hero | Video in "Watch" |
|---|---|---|---|---|
| M01 Demonstration / problem-first | Ad 01 "Three cat beds later, Bruce still wanted my chair." | `?angle=problem` (default) | "Your Cat Took Your Favorite Spot. Give Them One of Their Own." | Ad 01 concept (`assets/video/ad01-problem.mp4`, received 21 Oct; shows a white plush cave, disclosed) |
| M02 Testimonial / UGC | future UGC | `?angle=ugc` | "What Cat Owners Say Once Their Cat Moves In." (explains reviews appear when collected) | Ad 02 concept |
| M03 Educational | future | `?angle=education` | "Which Bed Will Your Cat Actually Use?" | Demo |
| M04 Storytelling | Ad 02 "I pay the mortgage. Bruce owns the house." | `?angle=story` | "I Pay the Mortgage. Bruce Owns the House." | Ad 02 concept (`assets/video/ad02-story.mp4`, received 21 Oct) |
| M05 Faceless / product | future | `?angle=product` | "An Enclosed Plush Cave With a Cow-Print Shell." | Demo |

CTA test (Test D): `?cta=a` Shop the Cat Cave · `?cta=b` Find Their Cozy Corner · `?cta=c` Choose Your Cat Cave. Invalid values fall back to defaults. Angle and CTA are recorded on every event. Product facts, price state and policies never change with the angle.

Example ad URL: `https://trading-app-3k96.vercel.app/products/cozy-cat-cave?angle=story&cta=a&utm_source=tiktok&utm_medium=paid&utm_campaign=cave_launch&utm_content=ad02_v1`

## E. Analytics and tracking

- `track(name, data)` pushes every event to `window.dataLayer` with `event_id`, `angle`, `cta_variant`, `product_id`, `page` and the stored attribution (`utm_*`, `fbclid`, `ttclid`, landing path and time, kept for the session).
- Standard funnel events: `PageView`, `ViewContent` (on load), `AddToCart` (live mode only, on add), `InitiateCheckout` (live mode, when "View cart" is followed). `Purchase` is never fired from this page: it must come from the order-confirmation source (Shopify) once checkout exists.
- Engagement events: `hero_cta_click` (place: header/hero/sticky/final), `video_open`, `video_play`, `video_complete`, `variant_select`, `size_guide_open` (the fit FAQ), `faq_expand`, `product_detail_interaction` (gallery), `waitlist_signup`.
- Pixels: the official Meta and TikTok snippets load only when `analytics.metaPixelId` / `analytics.tiktokPixelId` are set in the JSON and consent allows. Standard events are sent with the same `event_id` (`eventID` for Meta, `event_id` for TikTok) so server-side Conversions API / Events API calls can deduplicate. Events fired before the pixels load are queued and replayed.
- Server side: no server exists in the static site. When Shopify is connected, use Shopify's native Meta and TikTok channel integrations (they handle CAPI/Events API and Purchase with deduplication) or a small serverless function in the Next.js app. Access tokens live only there, never in this page.
- Consent: `analytics.consentRequired=false` by default (US). Set true to show the small consent notice and hold pixels until "Allow".
- Debug: with `analytics.debug=true` every event is logged to the browser console as `[urpick track]`.

**Pre-launch test procedure.** (1) Open the page with `?angle=problem&utm_source=test` and confirm in the console: PageView, ViewContent with your attribution. (2) Click the hero CTA, open the video, expand "Will my cat fit?", select a variant: confirm `hero_cta_click`, `video_open`, `size_guide_open`, `variant_select`. (3) Once IDs are set, use Meta Events Manager → Test Events and TikTok Events Manager → Test Events to see the same events with matching event IDs. (4) Once Shopify is live, place a test order and confirm exactly one Purchase arrives (browser or server, not both). (5) Run `tools/test_landing.py`, which asserts all of the above locally.

## F. Performance dashboard specification

Source of truth per metric (nothing is populated with invented numbers):

| Area | Metric | Source |
|---|---|---|
| Traffic | Sessions, traffic source, landing-page views, campaign and creative (`utm_campaign`, `utm_content`, `angle`, `cta_variant`) | GA4 or the dataLayer forwarded to GTM; ad platforms for spend |
| Engagement | Engaged sessions, video open/play/complete rate, CTA click rate (clicks ÷ PageView), product interactions (gallery, variant, FAQ) | dataLayer events above |
| Conversion | Add-to-cart rate, checkout initiation rate, purchase conversion rate, AOV | AddToCart / InitiateCheckout from the page; Purchase and order value from Shopify |
| Advertising | Spend, CPA, ROAS, attributed revenue | Meta and TikTok Ads Manager, reconciled with Shopify orders by UTM |
| Economics | Selling price, landed cost, shipping subsidy, payment fees, other variable costs → contribution margin, break-even CPA, target CPA | Finance inputs; formula: break-even CPA = contribution margin per order; target CPA = margin × (1 − desired profit share) |

Recommended first build: a Google Sheet with one row per day × campaign × angle, fed by GA4 export and ad-platform CSVs, until volume justifies a BI tool.

## G. A/B testing architecture

- Variants are chosen by URL so the ad platform assigns traffic and the page stays deterministic: `angle` (Test A: problem vs story; also the five formats), `cta` (Test D). Test B (hero media) and Test C (objection emphasis) are switched by editing `media` order / FAQ order in the JSON per variant; add a `?v=` key the same way when needed.
- One variable per test. Run A/B with equal budgets, same audiences, same dates.
- Record on every event and order: creative id (`utm_content`), landing variant (`angle`, `cta`), campaign id (`utm_campaign`), date.
- Decide only with enough purchases per arm; as a rule of thumb do not call a winner below roughly 100 conversions per variant, and check the difference with a two-proportion test rather than eyeballing. Early reads at the add-to-cart stage are indicative only.
- Test E (offer, bundles) waits for approved pricing.

## H. Validation report

Tested (locally, served from `site/` over HTTP; chromium at 1280, 768 and 390 px) — 121 checks after the 22 Oct simplification:
- Route renders; clean URL with and without trailing slash; both base paths generated.
- Angle switching for all five formats, invalid value falls back; CTA test variants; product facts unchanged across angles.
- Five-section order, single h1, alt text, 'Final photo pending' placeholders, keyboard reach, 44 px targets, no horizontal overflow, page height under 4000 px desktop / 6200 px phone.
- Gallery: thumbnail switching, lightbox open/close, prev/next, arrow keys with wrap, swipe on touch widths, focus return.
- Upsell: one/two selection drives quantity, nothing auto-added, action disabled with a 'Pending price' label, no bundle price or discount shown.
- Preview purchase state: no invented price, add to cart disabled and explained, waitlist validation and local save with attribution, no payment path.
- Analytics: PageView, ViewContent, engagement events, event ids, attribution on every event, no Purchase, no AddToCart in preview, no pixel scripts without IDs.
- No fabricated proof strings (ratings, counts, guarantees, scarcity); AI ad concepts disclosed.
- Main site unaffected (its 359-check suite passes).

Not verified / not possible yet:
- Ad 01 and Ad 02 concept videos are in (830×1108 portrait, re-encoded H.264 + AAC, ~4 MB each, posters extracted). They play only on click, in a portrait modal, with the AI-concept disclosure under the player; the hero shows the angle's poster frame with a play button. Still placeholders: Bruce photos, product photography, demonstration footage. Playback itself could not be watched in the test browser (no H.264 decoder); the files are standard MP4.
- Live mode (price, stock, Add to cart into the shared cart, InitiateCheckout): code path exists but is inactive until `status: "live"` and a price are set; it has not been exercised with real Shopify variant IDs.
- Pixel delivery, CAPI/Events API, Purchase: no IDs, no server, no checkout.
- Real Core Web Vitals in the field: the page is static, inline-styled, lazy-loads images and does not autoplay video, which is favourable, but numbers come only once real media is in.

## I. Launch checklist

Required before paid traffic:
1. Supplier confirms dimensions, materials, construction, care and safety → fill `specs` in the JSON.
2. Approve selling price (and compare-at if any), stock → set `price`, `stock`, `status: "live"`.
3. Product photography (six views + hero), Bruce photos (three), demo video → drop files in `assets/` and set `src` fields. Ad 01 and Ad 02 are in; decide whether Ad 01 (white cave) may run against the cow-print page or needs a cow-print re-render.
4. Connect checkout (Shopify) and set variant IDs; verify Add to cart → cart → checkout end to end.
5. Final shipping and returns policy → update the drafts and remove the "draft" flags.
6. Meta Pixel ID and TikTok Pixel ID → `analytics`; server-side tokens in Shopify or a serverless function, never in the page.
7. Run the pre-launch test procedure and both test suites.
8. Decide consent behaviour for non-US traffic.

Optional, after launch:
- Collect reviews and photos with permission → populate the UGC angle and the Reviews card.
- Write the introduction guide → enable the offer card.
- Add bundle pricing once approved → Test E.
- Move to Shopify-native landing or hydrate from the Storefront API.

## J. Deployment

- Preview locally: `cd landing-pages/urpick-site && python3 tools/build.py --deploy && (cd site && python3 -m http.server 8765)` then open http://127.0.0.1:8765/products/cozy-cat-cave/?angle=story
- Test: `python3 tools/test_landing.py http://127.0.0.1:8765 /tmp/shots` and `python3 tools/test_nav.py "$PWD/site/index.html" /tmp/shots`
- Deploy: commit `landing-pages/urpick-site` and `public/urpick`, push to the working branch, mirror to the default branch (`claude/trading-app-nextjs-setup-1r2LD`); Vercel builds the `urpick` project automatically. The route becomes `https://trading-app-3k96.vercel.app/products/cozy-cat-cave`.
- The page ships in preview state. Switching to live is a JSON change (`status`, `price`, `stock`, variant IDs) plus a rebuild; do not flip it without the checklist above.
