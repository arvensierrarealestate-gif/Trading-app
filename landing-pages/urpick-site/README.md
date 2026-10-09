# UrPick pre-launch site

Static rebuild of the UrPick site template (the React/Tailwind build supplied on 9 Oct 2026) in its exact section order and visual language: announcement bar, sticky header, 4:5 hero, benefit strip, use-case cards, four-step process, "why" section with callouts, dark gallery band, product block, FAQ, newsletter, footer. Fraunces and Inter on cream, sand, sage and clay, with the template's button and card radii and shadows.

Because there is no product yet, the product block is a "coming soon" panel with the waitlist in place of price, variants and add-to-cart. The layout is unchanged, so the product drops in later without a redesign. Cart drawer and Shopify Storefront hooks from the template are intentionally left out until then.

- `index.src.html` — source. Edit this.
- `index.html` — built page with the six photos inlined once each as CSS classes `.photo-<name>`. Regenerate with `python3 tools/build.py`.
- `assets/photos/` — the six supplied lifestyle photos.

Placeholders still open: shipping, returns and contact answers in the FAQ and reassurance row; social and company footer links; account link; the review widget. "Show build notes" in the top bar reveals the mapping of each photo to its template slot.

## Navigation drawer (added 9 Oct 2026)

Header: hamburger (left), logo (centre), "Join the list" and account icon (right). The template's horizontal links and its separate mobile panel were consolidated into the drawer's "On this page" group; nothing was removed.

Drawer items, in order: Product (`#coming-soon`), Contact (`#contact`), Track Your Order (`#track-order`), About Us (`#about`). The last three are routed pages inside `index.html`: the hash shows the page and hides the homepage; any other hash shows the homepage and scrolls to that section. Active item carries `aria-current="page"`.

Behaviour: slides in from the left, closes on X, overlay click, Escape, or choosing an item; focus moves to the close button on open and back to the hamburger on close; Tab is trapped inside; background scroll is locked; reduced-motion disables the animation; all targets are 44 px or taller.

Not connected: the Contact form and the Track Your Order lookup validate input and then state plainly that no email service or Shopify order lookup is wired yet. No message is sent and no tracking result is shown. There is no cart on the site yet because there is no product; the template's cart drawer returns with the product.

Tests: `python3 tools/test_nav.py "$(pwd)/index.html" <screenshot-dir>` runs 90 Playwright checks across desktop, tablet and mobile (see commit message for the list).
