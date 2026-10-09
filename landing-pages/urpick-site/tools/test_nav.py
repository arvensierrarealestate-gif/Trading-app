import sys, json
from playwright.sync_api import sync_playwright
PAGE = sys.argv[1]; OUT = sys.argv[2]
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS" if ok else "FAIL"), name, detail)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH, headless=True, args=["--no-sandbox"])
    for (w, h, label) in [(1280, 900, "desktop"), (768, 1024, "tablet"), (390, 844, "mobile")]:
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.goto("file://" + PAGE); pg.wait_for_timeout(500)
        # no horizontal overflow
        sw = pg.evaluate("document.documentElement.scrollWidth"); check(f"[{label}] no horizontal overflow", sw <= w, f"scrollWidth={sw}")
        # no duplicate horizontal nav
        check(f"[{label}] no horizontal nav / old mobile panel", pg.locator("nav.primary").count() == 0 and pg.locator("#mobile-nav").count() == 0)
        # header layout: hamburger left, logo centred, actions right
        mb = pg.locator("#menuBtn").bounding_box(); logo = pg.locator("header.site .brand").bounding_box(); acts = pg.locator("header.site .hdr-actions").bounding_box()
        logo_c = logo["x"] + logo["width"] / 2
        check(f"[{label}] hamburger at left, logo centred, actions right", mb["x"] < 40 and abs(logo_c - w / 2) < 12 and acts["x"] + acts["width"] > w - 40, f"menu.x={mb['x']:.0f} logoCenter={logo_c:.0f} actionsRight={acts['x']+acts['width']:.0f}")
        # open via hamburger
        pg.click("#menuBtn"); pg.wait_for_timeout(350)
        drawer_visible = pg.evaluate("!document.getElementById('drawerRoot').hidden && document.getElementById('drawerRoot').classList.contains('open')")
        check(f"[{label}] drawer opens", drawer_visible)
        check(f"[{label}] focus moves to close button", pg.evaluate("document.activeElement && document.activeElement.id") == "drawerClose")
        check(f"[{label}] background scroll locked", pg.evaluate("getComputedStyle(document.body).overflow") == "hidden")
        check(f"[{label}] aria-expanded true", pg.get_attribute("#menuBtn", "aria-expanded") == "true")
        order = pg.eval_on_selector_all(".drawer-primary a", "els => els.map(e => e.textContent.trim())")
        check(f"[{label}] menu order", order == ["Product", "Contact", "Track Your Order", "About Us"], str(order))
        check(f"[{label}] active = Product on home", pg.get_attribute('.drawer-primary a[data-route="home"]', "aria-current") == "page")
        tap = pg.eval_on_selector_all(".drawer-primary a, .drawer-secondary a, #drawerClose", "els => Math.min(...els.map(e => e.getBoundingClientRect().height))")
        check(f"[{label}] tap targets >= 44px", tap >= 44, f"min={tap}")
        # drawer within viewport width
        dw = pg.locator("#navDrawer").bounding_box(); check(f"[{label}] drawer fits viewport", dw["width"] <= w and dw["x"] >= 0, f"width={dw['width']:.0f}")
        if label == "desktop": pg.screenshot(path=f"{OUT}/drawer-desktop.png")
        if label == "mobile": pg.screenshot(path=f"{OUT}/drawer-mobile.png")
        # Tab trap: shift+tab from close button wraps to last focusable
        pg.keyboard.press("Shift+Tab"); last_id = pg.evaluate("document.activeElement.textContent.trim()")
        check(f"[{label}] focus trap wraps backwards", last_id == "Join the list", last_id)
        pg.keyboard.press("Tab"); check(f"[{label}] focus trap wraps forwards", pg.evaluate("document.activeElement.id") == "drawerClose")
        # Escape closes, focus returns
        pg.keyboard.press("Escape"); pg.wait_for_timeout(350)
        check(f"[{label}] Escape closes", pg.evaluate("document.getElementById('drawerRoot').hidden"))
        check(f"[{label}] focus returns to hamburger", pg.evaluate("document.activeElement.id") == "menuBtn")
        check(f"[{label}] scroll unlocked", pg.evaluate("getComputedStyle(document.body).overflow") != "hidden")
        # overlay click closes
        pg.click("#menuBtn"); pg.wait_for_timeout(350); pg.mouse.click(w - 10, h / 2); pg.wait_for_timeout(350)
        check(f"[{label}] click outside closes", pg.evaluate("document.getElementById('drawerRoot').hidden"))
        # X closes
        pg.click("#menuBtn"); pg.wait_for_timeout(350); pg.click("#drawerClose"); pg.wait_for_timeout(350)
        check(f"[{label}] X closes", pg.evaluate("document.getElementById('drawerRoot').hidden"))
        # navigate to each destination
        for route, text, sel in [("contact", "Contact", "#page-contact"), ("track-order", "Track Your Order", "#page-track"), ("about", "About Us", "#page-about")]:
            pg.click("#menuBtn"); pg.wait_for_timeout(350); pg.click(f'.drawer-primary a[data-route="{route}"]'); pg.wait_for_timeout(350)
            shown = pg.evaluate(f"document.querySelector('{sel}').classList.contains('active') && document.getElementById('main').hidden")
            check(f"[{label}] {text} -> page shown, home hidden, drawer closed", shown and pg.evaluate("document.getElementById('drawerRoot').hidden"))
            pg.click("#menuBtn"); pg.wait_for_timeout(300)
            check(f"[{label}] {text} highlighted as active", pg.get_attribute(f'.drawer-primary a[data-route="{route}"]', "aria-current") == "page")
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            if label == "desktop": pg.screenshot(path=f"{OUT}/page-{route}.png", full_page=False)
        # Product -> home, coming-soon in view
        pg.click("#menuBtn"); pg.wait_for_timeout(350); pg.click('.drawer-primary a[data-route="home"]'); pg.wait_for_timeout(1500)
        in_view = pg.evaluate("(function(){var r=document.getElementById('coming-soon').getBoundingClientRect(); return !document.getElementById('main').hidden && r.top < window.innerHeight && r.bottom > 0;})()")
        check(f"[{label}] Product -> home, coming-soon section in view", in_view)
        # forms: contact + track show 'not connected' status, no fake results
        pg.goto("file://" + PAGE + "#contact"); pg.wait_for_timeout(300)
        pg.fill("#contactName", "Test"); pg.fill("#contactEmail", "t@example.com"); pg.fill("#contactMessage", "Hello"); pg.click("#contactForm button[type=submit]")
        check(f"[{label}] contact form -> not-connected notice", pg.evaluate("document.getElementById('contactStatus').classList.contains('show')"))
        pg.goto("file://" + PAGE + "#track-order"); pg.wait_for_timeout(300)
        pg.fill("#trackOrder", "1001"); pg.fill("#trackEmail", "t@example.com"); pg.click("#trackForm button[type=submit]")
        check(f"[{label}] track form -> not-connected notice", pg.evaluate("document.getElementById('trackStatus').classList.contains('show')"))
        # deep link + home sections still present
        pg.goto("file://" + PAGE + "#faq"); pg.wait_for_timeout(1500)
        check(f"[{label}] home anchors still work", pg.evaluate("!document.getElementById('main').hidden && document.getElementById('faq').getBoundingClientRect().top < 120"))
        check(f"[{label}] homepage sections intact", pg.evaluate("['top','moments','how-we-work','why-urpick','gallery','coming-soon','faq','newsletter'].every(id => !!document.getElementById(id))"))
        check(f"[{label}] waitlist + video present", pg.evaluate("!!document.getElementById('waitForm') && document.querySelectorAll('video[data-video]').length === 2"))
        pg.close()
    b.close()
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed"); sys.exit(1 if fails else 0)
