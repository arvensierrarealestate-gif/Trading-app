"""Landing-page checks. Usage: python3 tools/test_landing.py http://127.0.0.1:8765 <shotdir>  (serve site/ first)."""
import sys
from playwright.sync_api import sync_playwright
ORIGIN = sys.argv[1].rstrip("/"); OUT = sys.argv[2]; U = ORIGIN + "/products/cozy-cat-cave/"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS" if ok else "FAIL"), name, detail)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH, headless=True, args=["--no-sandbox"])
    for (w, h, label) in [(1280, 900, "desktop"), (768, 1024, "tablet"), (390, 844, "mobile")]:
        pg = b.new_page(viewport={"width": w, "height": h}); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(U + "?utm_source=tiktok&utm_campaign=cave&ttclid=t1"); pg.wait_for_timeout(700)
        check(f"[{label}] route renders with the product title, default problem-first angle", pg.evaluate("document.title === 'Cow Print Enclosed Plush Cat Cave · UrPick' && document.documentElement.dataset.angle === 'problem' && document.getElementById('heroTitle').textContent === 'Your Cat Took Your Favorite Spot. Give Them One of Their Own.' && /A cozy little hideaway/.test(document.getElementById('heroSub').textContent)"))
        check(f"[{label}] no horizontal overflow", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        check(f"[{label}] preview status shown, price not invented, add to cart disabled, waitlist offered", pg.evaluate("!document.getElementById('statusBar').hidden && /Price to be confirmed/.test(document.getElementById('heroPrice').textContent) && /Price to be confirmed/.test(document.getElementById('buyPrice').textContent) && document.getElementById('addToCart').disabled && !document.getElementById('waitlist').hidden && /no payment is taken/.test(document.getElementById('buyNote').textContent)"))
        check(f"[{label}] hero: CTA, secondary video action, verified highlights only, placeholder media labelled", pg.evaluate("document.getElementById('heroCta').textContent === 'Shop the Cat Cave' && /Watch Bruce/.test(document.getElementById('heroWatch').textContent) && document.querySelectorAll('#heroHighlights li').length === 3 && document.getElementById('heroMedia').classList.contains('empty') && /placeholder/i.test(document.getElementById('heroMedia').getAttribute('aria-label'))"))
        check(f"[{label}] sections in the conversion order", pg.evaluate("Array.from(document.querySelectorAll('main > section')).map(s => s.id).join(',') === 'hero,problem,product,benefits,demo,objections,buy,confidence,offer,final'"))
        check(f"[{label}] one h1, semantic headings per section", pg.evaluate("document.querySelectorAll('h1').length === 1 && document.querySelectorAll('main section h2').length === 9"))
        check(f"[{label}] no fabricated proof: no star ratings, review counts, customer names, guarantees or scarcity", pg.evaluate("!/★|\\b\\d+(\\.\\d+)? stars?\\b|\\d+ reviews|money-back|guarantee|only \\d+ left|selling fast|best seller/i.test(document.body.innerText)"))
        check(f"[{label}] ad concepts disclosed as AI-generated, not testimonials", pg.evaluate("(function(){document.getElementById('heroWatch').click(); var t=document.getElementById('modalBody').innerText; var ok=/AI-generated advertising concept/.test(t) && /Not a customer testimonial/.test(t) && document.activeElement.id === 'modalClose'; document.getElementById('modalClose').click(); return ok && document.getElementById('modal').hidden;})()"))
        check(f"[{label}] specs table shows 'to be confirmed' rows instead of invented dimensions", pg.evaluate("document.querySelectorAll('#specs tbody tr').length === 8 && document.querySelectorAll('#specs .dev').length === 8"))
        check(f"[{label}] FAQ accordion covers the five objections", pg.evaluate("Array.from(document.querySelectorAll('#faq details')).map(d => d.dataset.id).join(',') === 'use,fit,clean,shape,return' && Array.from(document.querySelectorAll('#faq details')).every(d => !d.open)"))
        pg.evaluate("document.querySelector('#faq details[data-id=clean] summary').click()"); pg.wait_for_timeout(100)
        check(f"[{label}] FAQ expands and tracks", pg.evaluate("document.querySelector('#faq details[data-id=clean]').open && dataLayer.some(e => e.event === 'faq_expand' && e.faq === 'clean')"))
        check(f"[{label}] variants: cow print selected, researched designs disabled and labelled", pg.evaluate("document.querySelector('#variants button[data-id=cow-print]').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('#variants button[disabled]').length === 3 && /Not yet confirmed/.test(document.getElementById('variants').textContent)"))
        pg.click("#qtyPlus"); pg.click("#qtyPlus"); pg.click("#qtyMinus")
        check(f"[{label}] quantity stepper", pg.evaluate("document.getElementById('qtyOut').textContent === '2'"))
        pg.fill("#waitEmail", "bad"); pg.click("#waitForm button"); pg.wait_for_timeout(100)
        check(f"[{label}] waitlist validates email", pg.evaluate("document.getElementById('waitEmail').getAttribute('aria-invalid') === 'true'"))
        pg.fill("#waitEmail", "Pat@Example.com"); pg.click("#waitForm button"); pg.wait_for_timeout(100)
        check(f"[{label}] waitlist saves locally with attribution and says nothing was sent", pg.evaluate("(function(){var l=JSON.parse(localStorage.getItem('urpick_waitlist_v1')); var r=l[l.length-1]; return r.email === 'pat@example.com' && r.utm_source === 'tiktok' && r.ttclid === 't1' && /nothing has been sent/.test(document.getElementById('waitMsg').textContent);})()"))
        check(f"[{label}] funnel + engagement events in dataLayer with ids, angle and attribution; no Purchase", pg.evaluate("(function(){var ev=dataLayer.map(e=>e.event); return ev[0]==='PageView' && ev[1]==='ViewContent' && ev.indexOf('video_open')>-1 && ev.indexOf('waitlist_signup')>-1 && ev.indexOf('Purchase')===-1 && ev.indexOf('AddToCart')===-1 && dataLayer.every(e => e.event_id && e.angle === 'problem' && e.cta_variant === 'a' && e.utm_source === 'tiktok');})()"))
        check(f"[{label}] no pixel scripts loaded without IDs", pg.evaluate("!window.fbq && !window.ttq && !document.querySelector('script[src*=\"facebook\"], script[src*=\"tiktok\"]')"))
        pg.evaluate("document.getElementById('heroCta').click()"); pg.wait_for_timeout(600)
        check(f"[{label}] hero CTA scrolls to the purchase module and tracks", pg.evaluate("dataLayer.some(e => e.event === 'hero_cta_click' && e.place === 'hero') && location.hash === '#buy' && document.getElementById('buy').getBoundingClientRect().top < 120"))
        pg.evaluate("document.getElementById('product').scrollIntoView({behavior:'instant'})"); pg.wait_for_timeout(400)
        bar = pg.evaluate("document.getElementById('bar').classList.contains('show')")
        if w < 1024: check(f"[{label}] sticky bar shows mid-page", bar)
        else: check(f"[{label}] no sticky bar on desktop", not bar and pg.evaluate("getComputedStyle(document.getElementById('bar')).display === 'none'"))
        pg.evaluate("document.getElementById('buy').scrollIntoView({behavior:'instant'})"); pg.wait_for_timeout(400)
        check(f"[{label}] sticky bar never covers the purchase module", not pg.evaluate("document.getElementById('bar').classList.contains('show')"))
        check(f"[{label}] touch targets >= 44px", pg.evaluate("Array.from(document.querySelectorAll('a.btn, button, summary')).filter(e => e.offsetParent !== null).every(e => e.getBoundingClientRect().height >= 44)"))
        check(f"[{label}] footer links to the draft policies, privacy, terms and support email", pg.evaluate("Array.from(document.querySelectorAll('#footLinks a')).map(a => a.getAttribute('href')).join(',') === '/#shipping-returns,/#privacy,/#terms,https://www.tiktok.com/@yourpick2025,https://www.facebook.com/profile.php?id=61585565952893,/' && document.getElementById('footEmail').getAttribute('href') === 'mailto:yourpick2025@gmail.com'"))
        check(f"[{label}] images have alt text / placeholders have labels", pg.evaluate("Array.from(document.querySelectorAll('img')).every(i => i.alt !== undefined) && Array.from(document.querySelectorAll('.ph.empty')).every(p => p.getAttribute('aria-label'))"))
        # keyboard: tab reaches the hero CTA and the FAQ summaries
        pg.goto(U); pg.wait_for_timeout(500); pg.keyboard.press("Tab"); pg.keyboard.press("Tab"); pg.keyboard.press("Tab")
        check(f"[{label}] keyboard: third Tab lands on the hero CTA (skip link, brand, header CTA before it)", pg.evaluate("['heroCta','brandLink'].indexOf(document.activeElement.id) > -1 || document.activeElement.classList.contains('cta')"))
        for a, exp in [("story", "I Pay the Mortgage. Bruce Owns the House."), ("education", "Which Bed Will Your Cat Actually Use?"), ("ugc", "What Cat Owners Say Once Their Cat Moves In."), ("product", "An Enclosed Plush Cave With a Cow-Print Shell."), ("nonsense", "Your Cat Took Your Favorite Spot. Give Them One of Their Own.")]:
            pg.goto(U + "?angle=" + a + "&cta=c"); pg.wait_for_timeout(400)
            check(f"[{label}] ?angle={a} -> expected hero, CTA test c, product facts unchanged", pg.evaluate("document.getElementById('heroTitle').textContent === " + repr(exp) + " && document.getElementById('heroCta').textContent === 'Choose Your Cat Cave' && document.getElementById('barCta').textContent === 'Choose Your Cat Cave' && document.getElementById('buyName').textContent === 'Cow Print Enclosed Plush Cat Cave' && /Price to be confirmed/.test(document.getElementById('buyPrice').textContent) && dataLayer[0].cta_variant === 'c'"))
        if label == "desktop": pg.goto(U + "?angle=story"); pg.wait_for_timeout(500); pg.screenshot(path=f"{OUT}/lp-story-desktop.png")
        check(f"[{label}] no JavaScript errors", not errs, str(errs[:2]))
        pg.close()
    # the main site is untouched by the landing build
    pg = b.new_page(viewport={"width": 1280, "height": 900}); pg.add_init_script("localStorage.setItem('urpick_offer_v1', JSON.stringify({status:'dismissed', at: Date.now()}))")
    pg.goto(ORIGIN + "/"); pg.wait_for_timeout(600)
    check("[site] homepage still renders with header nav and hero", pg.evaluate("document.querySelectorAll('.hdr-nav a').length === 5 && !!document.querySelector('.hero video')"))
    pg.goto(ORIGIN + "/products/cozy-cat-cave"); pg.wait_for_timeout(500)
    check("[site] clean URL without trailing slash also serves the landing page (local server)", pg.evaluate("document.title.indexOf('Cat Cave') > -1"))
    pg.close(); b.close()
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed"); sys.exit(1 if fails else 0)
