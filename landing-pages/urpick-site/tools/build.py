#!/usr/bin/env python3
"""Build index.html from index.src.html: each photo in assets/photos becomes one
CSS class `.photo-<name>` with the image inlined once as a data URI, so a photo
can be reused in several places without repeating the bytes.
Run: python3 tools/build.py"""
import base64
import glob
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
src = open(os.path.join(ROOT, "index.src.html")).read()

rules = []
for path in sorted(glob.glob(os.path.join(ROOT, "assets", "photos", "*.jpg"))):
    name = os.path.splitext(os.path.basename(path))[0]
    with open(path, "rb") as f:
        uri = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    rules.append(f".photo-{name}{{background-image:url('{uri}')}}")

block = "<style>\n" + "\n".join(rules) + "\n</style>\n"
out = src.replace("</style>\n", "</style>\n" + block, 1)
open(os.path.join(ROOT, "index.html"), "w").write(out)
print(f"index.html written: {len(out) // 1024} KB, {len(rules)} photos inlined")
