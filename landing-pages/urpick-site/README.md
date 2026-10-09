# UrPick pre-launch site

Static rebuild of the UrPick site template (the React/Tailwind build supplied on 9 Oct 2026) in its exact section order and visual language: announcement bar, sticky header, 4:5 hero, benefit strip, use-case cards, four-step process, "why" section with callouts, dark gallery band, product block, FAQ, newsletter, footer. Fraunces and Inter on cream, sand, sage and clay, with the template's button and card radii and shadows.

Because there is no product yet, the product block is a "coming soon" panel with the waitlist in place of price, variants and add-to-cart. The layout is unchanged, so the product drops in later without a redesign. Cart drawer and Shopify Storefront hooks from the template are intentionally left out until then.

- `index.src.html` — source. Edit this.
- `index.html` — built page with the six photos inlined once each as CSS classes `.photo-<name>`. Regenerate with `python3 tools/build.py`.
- `assets/photos/` — the six supplied lifestyle photos.

Placeholders still open: shipping, returns and contact answers in the FAQ and reassurance row; social and company footer links; account link; the review widget. "Show build notes" in the top bar reveals the mapping of each photo to its template slot.
