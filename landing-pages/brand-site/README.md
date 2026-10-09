# Brand site (pre-launch, no products)

Premium pre-launch homepage for the pet-care brand, built from the five lifestyle photos supplied on 9 Oct 2026. No products, prices, or claims; the only action is a waitlist sign-up.

- `index.src.html` — source. Edit this. Photos are referenced as `{{PHOTO:name}}`.
- `index.html` — built page with photos inlined. Regenerate with `python3 tools/build.py`.
- `assets/photos/` — the supplied photos, resized to 1600 px max and saved as JPEG: `hero-family`, `cat-fluffy`, `dog-cockapoo`, `cat-tabby`, `dog-and-cat`.

Before launch: replace "BRAND" with the final name and logo, wire the waitlist form to an email tool, and fill the footer links. The internal bar at the top is removed at launch.
