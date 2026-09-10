# Elevated Interactive Enrichment Lick Bowl — mock landing page

Premium, mobile-first direct-response landing page for the elevated interactive lick bowl, built to the 20-section brief. Traffic: Meta, TikTok, creator content. Funnel: ad → this page → exact Shopify product page → cart → checkout.

- `index.src.html` — the page source. Edit this.
- `index.html` — built output with stand-in images embedded. Regenerate with `python3 tools/build.py`. Open it directly in a browser.
- `assets/slots.json` — every image slot with its export size.
- `assets/standins/` — temporary images cut from the reference screen recording of the earlier URPICK page. They are low resolution and exist only so the layout can be judged. Replace each with a real photo saved as `assets/<slot>.jpg`, or drop the file onto the slot in the published mock with build notes on.

## Editable values

All commercial values live in the `CONFIG` object at the top of the script in `index.src.html`:

- `prices.bowl`, `prices.bundle`, `currency` — mock prices ($19.99 / $32.99), not final until supplier quotes.
- `dishwasherConfirmed` — keeps the "Dishwasher safe" line hidden until supplier documentation confirms it.
- `guaranteeText` — empty until business terms are approved. Research benchmark: 90 days is competitive in the category.
- `materialDocText` — empty until food-contact documentation exists.
- `boxContents` — what's-included list, editable until supplier selection.

Hero copy switches per ad angle with `?angle=routine|bath|mat`.

## CTA map

| `data-cta` | Where | Label | Destination |
|---|---|---|---|
| `nav_shop` | Nav | Shop the Bowl | Shopify product: bowl |
| `hero_primary` | Hero | Shop the Bowl | Shopify product: bowl |
| `hero_secondary` | Hero | See it in action | `#demo` |
| `demo_shop` | After demonstration | Shop the Enrichment Bowl | Shopify product: bowl |
| `uses_shop` | After use cases | Shop the Bowl | Shopify product: bowl |
| `recipes_shop` | After recipes | Get the Bowl + Recipe Guide | Shopify product: bowl |
| `offer_bowl` | Offer, option 1 | Get Your Bowl | Shopify product: bowl |
| `offer_bundle` | Offer, option 2 | Get the Bundle | Shopify bundle product |
| `final_primary` | Final close | Shop the Enrichment Bowl | Shopify product: bowl |
| `sticky_mobile` | Sticky mobile bar | Shop the Bowl | Shopify product: bowl |

Placeholder hrefs are `#SHOPIFY_PRODUCT_URL` and `#SHOPIFY_BUNDLE_URL`. Never the store home page. Pass inbound `utm_*` and `angle` through to Shopify.

## Image slots

| Slot | Brief placeholder | Used in | Export |
|---|---|---|---|
| `01-hero` | 1 Dog licking bowl hero | Hero | 1200×1500 |
| `02-food` | 2 Bowl with colourful food | Demo step 1, suction 04, cleaning 03 | 1000×1000 |
| `03-bath` | 3 Bath-time usage | Use cases | 1000×1000 |
| `04-nails` | 4 Nail-trim usage | Use cases | 1000×1000 |
| `05-grooming` | 5 Grooming usage | Use cases, suction 03 | 1000×1000 |
| `06-suction` | 6 Suction demonstration | Demo step 2, suction 01 | 1000×1000 |
| `07-wobble` | 7 Wobble / movement (video poster) | Movement | 1600×900 |
| `08-texture` | 8 Texture close-up | Use cases, suction 02, cleaning 02 | 1000×1000 |
| `09-onepiece` | 9 One-piece construction | Construction, cleaning 04 | 1200×900 |
| `10-freezer` | 10 Bowl in freezer | Demo step 3 | 1000×1000 |
| `11-recipes` | 11 Frozen recipe examples | Recipes | 1600×900 |
| `12-cleaning` | 12 Cleaning sequence | Cleaning 01, recipe 3 | 1000×1000 |
| `13-bundle` | 13 Bowl + snuffle mat | Value stack, recipe 2 | 1000×1000 |
| `14-flatlay` | 14 What's-in-the-box | Included | 1600×900 |
| `15-final` | 15 Final lifestyle | Final close, demo step 4, after, cleaning 05 | 1600×900 |
| `16-problem` | Problem visual | Problem, before | 1200×900 |
| `17-intro` | Solution visual | Problem | 1200×900 |

Several sections reuse a slot until dedicated photography exists (the suction and cleaning sequences in particular). Give each its own file later by adding new slot ids in `assets/slots.json` and `index.src.html`.

## Claims discipline

No health, anxiety, cortisol, veterinary, or behaviour-outcome claims anywhere. "Durable one-piece construction", never "chew-proof". Suction is "designed to help keep the bowl stable on suitable smooth surfaces". Supervision notice in the construction section and FAQ. Reviews section is an empty labelled placeholder.
