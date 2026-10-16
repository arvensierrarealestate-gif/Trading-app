# UrPick pre-launch site

Static rebuild of the UrPick site template (the React/Tailwind build supplied on 9 Oct 2026) in its exact section order and visual language: announcement bar, sticky header, 4:5 hero, benefit strip, use-case cards, four-step process, "why" section with callouts, dark gallery band, product block, FAQ, newsletter, footer. Fraunces and Inter on cream, sand, sage and clay, with the template's button and card radii and shadows.

The product block is the template's shop block with placeholder data: "[Product Name]", $0.00 "price set in Shopify", four colour options (A to D), a four-image gallery with the template's shot notes, quantity stepper, Add to Cart, and the reassurance row. All of it is driven by the `PRODUCT` object at the top of the shop script and is replaced by live Shopify data once the product exists. The waitlist (dog / cat / other pet chips) now lives in the newsletter box.

- `index.src.html` — source. Edit this.
- `index.html` — preview build, one file with all media inlined (used for the artifact link). Regenerate with `python3 tools/build.py`.
- `site/` — **deploy build**: a full HTML document plus `assets/` (photos, video, favicon) and a `vercel.json` with cache headers. Internal build-notes bar and notes are stripped. Regenerate with `python3 tools/build.py --deploy`. Point the host at this folder.
- `assets/photos/` — the six supplied lifestyle photos.

Placeholders still open: shipping and returns answers in the FAQ and reassurance row; company footer links (Shipping & Returns, Privacy, Terms); the contact email, TikTok and Facebook links are live; account link; the review widget. "Show build notes" in the top bar reveals the mapping of each photo to its template slot.

## Navigation drawer (added 9 Oct 2026)

Header: hamburger (left), logo (centre), "Join the list" and account icon (right). The template's horizontal links and its separate mobile panel were consolidated into the drawer's "On this page" group; nothing was removed.

Drawer items, in order: Products (a dropdown with Dogs `#products-dogs`, Cats `#products-cats`, Other Pets `#products-other`, each opening the shop section with that category selected), Contact (`#contact`), Track Your Order (`#track-order`), About Us (`#about`). The shop section has a matching All / Dogs / Cats / Other Pets bar; a category with no products shows a plain "coming soon" notice instead of a fake listing. The last three are routed pages inside `index.html`: the hash shows the page and hides the homepage; any other hash shows the homepage and scrolls to that section. Active item carries `aria-current="page"`.

Behaviour: slides in from the left, closes on X, overlay click, Escape, or choosing an item; focus moves to the close button on open and back to the hamburger on close; Tab is trapped inside; background scroll is locked; reduced-motion disables the animation; all targets are 44 px or taller.

Not connected: the Contact form and the Track Your Order lookup validate input and then state plainly that no email service or Shopify order lookup is wired yet. No message is sent and no tracking result is shown. There is no cart on the site yet because there is no product; the template's cart drawer returns with the product.

Tests: `python3 tools/test_nav.py "$(pwd)/index.html" <screenshot-dir>` runs 90 Playwright checks across desktop, tablet and mobile (see commit message for the list).

## Cart and checkout (added 9 Oct 2026)

- Header cart icon with a count badge, right of the account icon.
- Cart drawer slides in from the right: line items with colour and quantity, Remove, subtotal, "Shipping and taxes calculated at checkout", Checkout button. Closes on X, backdrop, Escape; focus trap and return; scroll lock. The cart persists in `localStorage` under the template's key `eb_cart_v1`.
- `#checkout` route: order summary (lines, subtotal, shipping and taxes "calculated at checkout", total) and a "Continue to Shopify checkout" button that stays disabled, with a notice saying so, until `SHOPIFY_CONNECTED` is true. No payment is taken and no order is created on this page.
- To go live: connect the Shopify Storefront API (domain and token as in the template's `.env`), load the product by handle into `PRODUCT`, set `SHOPIFY_CONNECTED = true`, and point the checkout button at the cart's `checkoutUrl`.

Tests: `tools/test_nav.py` now covers the shop block, cart, and checkout as well (126 checks across desktop, tablet, mobile).

## Going live

1. Vercel → Add New Project → import this GitHub repo → Root Directory `landing-pages/urpick-site/site` → Framework "Other", no build command, output directory `.` → Deploy. (Netlify / Cloudflare Pages: same folder, no build.)
2. Project → Settings → Domains → add the domain. Add the A and CNAME records it shows at the registrar. HTTPS is automatic.
3. Set the production branch to `claude/relaxed-brown-bm2ob8` (or merge it to the default branch). Every push that changes `site/` redeploys.

Before launch: connect the waitlist/newsletter form to an email service, publish Privacy and Terms, fill the shipping and returns placeholders (contact email yourpick2025@gmail.com is published in the FAQ, Contact page, Track page and footer), and connect Shopify (see "Cart and checkout").

## Welcome offer popup (added 15 Oct 2026)

First-visit overlay offering 15% off the first order in exchange for an email. Copy, states and rules as briefed: delayed 1.2 s on the homepage only; once per browsing session; never again after a signup; a 7-day cooldown after a dismissal (X, backdrop or Escape); email validated before submit; consent disclosure under the field with a Privacy Policy link; focus trap and scroll lock; near-full-screen on phones. Settings live in the `WELCOME_OFFER` object at the end of the script. State is kept in `localStorage` under `urpick_offer_v1` (`{status: "signed"|"dismissed", email, consent, confirmed, at}`).

**The discount is not faked.** Eligibility is decided by the store, not by this page. `WELCOME_OFFER.endpoint` is empty until a backend exists, so after a valid email the popup shows "You're in!" with the saved email and a plain "Not confirmed yet" notice, and the checkout page shows the same email with "not applied yet". When the endpoint is set, the popup `POST`s `{email, consent: true, source: "welcome-popup", percent: 15}` and expects `2xx {eligible: true|false, reason?}`; only `eligible: true` switches the success copy to "Your 15% first-order discount is ready" and the checkout line to "applied automatically".

Backend plan (Shopify): the endpoint (a Vercel serverless function or a Shopify app proxy) creates or finds the customer by email, records marketing consent (`emailMarketingConsent`), refuses with a reason if the customer already has an order or the `welcome15` tag, otherwise adds the `welcome15` tag. An automatic discount "Welcome 15%" (15% off, customer segment = tag `welcome15`, one use per customer) applies itself at checkout when that email is used; a Shopify Flow removes the tag after the first paid order. No code is shown to the customer at any point.

## Shop by pet tabs, product pages and cart drawer (15 Oct 2026)

- **Shop by pet** on the homepage is three tabs (Dogs default, Cats, Other Pets) over one panel: 3 featured cards per tab (placeholder image tile, bracketed name, $0.00 marked placeholder, bracketed benefit line, "View product") and a "View all … products →" link to that category's collection page. Tabs are click/tap (keyboard arrows too), swap content in place and never move the scroll position. The catalog is the `CATALOG` object in the script; real products replace the placeholders item by item.
- **Pages:** `#product-<id>` (the template product detail: gallery, colour options, quantity, Add to Cart), `#collection-<dogs|cats|other>` (all items in the category), `#cart` (full cart page with the same line controls, subtotal, Checkout and Continue shopping).
- **Cart drawer:** the cart icon opens the slide-out drawer on the current page. Each line shows image tile, name, colour, unit price, − / + quantity controls, Remove and line total; below: subtotal, shipping note, Checkout, View full cart (→ `#cart`), Continue shopping (closes the drawer in place). Count badge and subtotal update immediately; the cart persists in localStorage across pages and reloads.
- Tests: 190 checks across desktop, tablet and phone.

## Site architecture: standard header, Shop by need, collections, filters, search, help hub (16 Oct 2026)

Restructure only: the photos and the copy stayed as they were; the wording that changed is the wording the brief asked for.

- **Header (every page):** brand left; on desktop the text nav SHOP · SHOP BY PET · SHOP BY NEED · ABOUT · HELP in the middle, search and cart right. Below 1024px the text nav collapses into the hamburger drawer (Shop, Shop by pet ▸ Dogs / Cats / Other Pets, Shop by need ▸ six needs, About, Help ▸ Help centre / Contact / Track Your Order / FAQ / Shipping & Returns, Pet Parent Guide; foot button "Shop what made the cut"). The current section is underlined in the header and marked in the drawer; the drawer reopens with the current group expanded. The old "Shop Now" button and account icon are gone; the search icon opens a search dialog ("/" also opens it).
- **Homepage order:** hero (CTA "Shop what made the cut" → `#collection-all`, "How we choose ↓") → Shop by pet tabs → Shop by need (six cards) → How we choose (four steps unchanged, CTA "See what made the cut →") → Moments → Why UrPick → Customer experiences → FAQ → newsletter. Placeholder review cards are hidden (`#revList` is empty until real reviews exist). The "Tested at home" callout and "If we haven't tested it, we won't say it." line were replaced with claims we can stand behind, since nothing has been tested in homes yet.
- **Shop by need:** `#shop-by-need` hub ("What are you trying to solve?") and one page per need, `#need-<key>` for clean-home, better-walks, everyday-care, grooming, comfort-play, travel. Each need page runs: statement → paths (e.g. Laundry / Surfaces / Pet care / Learn; a path narrows the featured products, Learn opens the guide) → featured products → how to choose → proof (hidden until real) → FAQ → "Shop <need>" + "Read the guide". Need data lives in the `NEEDS` object; each placeholder product carries `need` and `path`.
- **Collections:** `#collection-all` ("What made the cut"), `#collection-<dogs|cats|other>` (pet tabs shown), `#collection-<need>`. Toolbar is FILTER | SORT with a live count. FILTER opens a side drawer (bottom sheet under 640px) with Pet / Need / Product type / Availability checkboxes and counts, CLEAR ALL and Show results; the grid updates as boxes are ticked and the FILTER button shows how many filters are active. Sort: Featured, Name, Price low–high / high–low. Price filtering waits for real prices.
- **Product page order:** eyebrow (pet · need) → name → benefit line → review summary ("No reviews yet …") → price → options → quantity → ADD TO CART → reassurance → accordions WHAT IT SOLVES / HOW IT WORKS / HOW TO USE IT / WHAT TO EXPECT / WHO IT'S FOR / WHAT'S INCLUDED / REAL CUSTOMER RESULTS / QUESTIONS / SHIPPING & RETURNS (bracketed placeholders until the supplier spec exists; customer results say "none yet"). Below 1024px a sticky bar with name, price and Add to cart appears once the buy row has scrolled off the top.
- **Pet Parent Guide (`#guide`):** architecture only. Planned topics with a "Planned" tag and a link to the related need; a notice says nothing is published yet. No articles are fabricated.
- **Help hub (`#help`):** six cards (Contact, Track your order, FAQ, Shipping & Returns, Privacy, Terms) plus an email button. Footer columns are Shop / Company / Help.
- **About:** same copy and photo, plus the brief's "The pet aisle is full. Your home does not need all of it." block and the closing "Only the useful stuff should make the cut.", ending with Shop by pet + Shop by need.
- **Popup:** unchanged; it still shows only on the homepage, not on any routed page.
- Tests: 304 checks across desktop, tablet and phone (`tools/test_nav.py`).
