# UrPick pre-launch site

Static rebuild of the UrPick site template (the React/Tailwind build supplied on 9 Oct 2026) in its exact section order and visual language: announcement bar, sticky header, 4:5 hero, benefit strip, use-case cards, four-step process, "why" section with callouts, dark gallery band, product block, FAQ, newsletter, footer. Fraunces and Inter on cream, sand, sage and clay, with the template's button and card radii and shadows.

The product block is the template's shop block with placeholder data: "[Product Name]", $0.00 "price set in Shopify", four colour options (A to D), a four-image gallery with the template's shot notes, quantity stepper, Add to Cart, and the reassurance row. All of it is driven by the `PRODUCT` object at the top of the shop script and is replaced by live Shopify data once the product exists. The waitlist (dog / cat / other pet chips) now lives in the newsletter box.

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

## Cart and checkout (added 9 Oct 2026)

- Header cart icon with a count badge, right of the account icon.
- Cart drawer slides in from the right: line items with colour and quantity, Remove, subtotal, "Shipping and taxes calculated at checkout", Checkout button. Closes on X, backdrop, Escape; focus trap and return; scroll lock. The cart persists in `localStorage` under the template's key `eb_cart_v1`.
- `#checkout` route: order summary (lines, subtotal, shipping and taxes "calculated at checkout", total) and a "Continue to Shopify checkout" button that stays disabled, with a notice saying so, until `SHOPIFY_CONNECTED` is true. No payment is taken and no order is created on this page.
- To go live: connect the Shopify Storefront API (domain and token as in the template's `.env`), load the product by handle into `PRODUCT`, set `SHOPIFY_CONNECTED = true`, and point the checkout button at the cart's `checkoutUrl`.

Tests: `tools/test_nav.py` now covers the shop block, cart, and checkout as well (126 checks across desktop, tablet, mobile).
