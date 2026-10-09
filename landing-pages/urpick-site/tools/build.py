#!/usr/bin/env python3
"""Build the UrPick page.

  python3 tools/build.py            -> index.html   (single file, media inlined; used for the artifact preview)
  python3 tools/build.py --deploy   -> site/        (full HTML document + assets/ as separate files; deploy this folder)

The deploy build drops the internal build-notes bar and the build-note blocks.
"""
import base64
import glob
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
src = open(os.path.join(ROOT, "index.src.html")).read()
deploy = "--deploy" in sys.argv

photos = sorted(glob.glob(os.path.join(ROOT, "assets", "photos", "*.jpg")))
rules = []
for path in photos:
    name = os.path.splitext(os.path.basename(path))[0]
    if deploy:
        rules.append(f".photo-{name}{{background-image:url('assets/photos/{name}.jpg')}}")
    else:
        with open(path, "rb") as f:
            uri = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
        rules.append(f".photo-{name}{{background-image:url('{uri}')}}")
block = "<style>\n" + "\n".join(rules) + "\n</style>\n"
out = src.replace("</style>\n", "</style>\n" + block, 1)

def video(m):
    name = m.group(1)
    if deploy:
        return f"assets/video/{name}.mp4"
    with open(os.path.join(ROOT, "assets", "video", name + ".mp4"), "rb") as f:
        return "data:video/mp4;base64," + base64.b64encode(f.read()).decode()
out = re.sub(r"\{\{VIDEO:([a-z0-9-]+)\}\}", video, out)

if not deploy:
    open(os.path.join(ROOT, "index.html"), "w").write(out)
    print(f"index.html written: {len(out) // 1024} KB, {len(rules)} photos inlined")
    sys.exit(0)

# ── deploy: strip internal chrome, wrap in a full document, copy assets ──
out = re.sub(r'<div class="mockbar">.*?</div>\s*</div>\n', "", out, count=1, flags=re.S)
out = re.sub(r'\s*<div class="note">.*?</div>', "", out, flags=re.S)
out = out.replace('<meta charset="utf-8">\n', "", 1)
title = re.search(r"<title>(.*?)</title>", out).group(1)
out = out.replace(f"<title>{title}</title>\n", "", 1)
head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="UrPick — everyday essentials for pets and the people who love them. Coming soon.">
<meta property="og:title" content="{title}">
<meta property="og:description" content="Everyday essentials for pets and the people who love them.">
<meta property="og:image" content="assets/photos/hero-family.jpg">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preload" as="video" href="assets/video/hero-loop.mp4" type="video/mp4">
</head>
<body>
"""
doc = head + out + "\n</body>\n</html>\n"

site = os.path.join(ROOT, "site")
shutil.rmtree(site, ignore_errors=True)
os.makedirs(os.path.join(site, "assets", "photos"))
os.makedirs(os.path.join(site, "assets", "video"))
for path in photos:
    shutil.copy(path, os.path.join(site, "assets", "photos"))
for path in glob.glob(os.path.join(ROOT, "assets", "video", "hero-loop*")):
    shutil.copy(path, os.path.join(site, "assets", "video"))
favicon = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2F4A3A"/><text x="32" y="43" text-anchor="middle" font-family="Georgia,serif" font-size="34" font-weight="600" fill="#FAF6EF">U</text></svg>"""
open(os.path.join(site, "assets", "favicon.svg"), "w").write(favicon)
open(os.path.join(site, "index.html"), "w").write(doc)
open(os.path.join(site, "vercel.json"), "w").write('{\n  "cleanUrls": true,\n  "headers": [\n    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }\n  ]\n}\n')
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(site) for f in fs)
print(f"site/ written: index.html {len(doc) // 1024} KB, folder {total // 1024} KB, mock bar and notes stripped")
