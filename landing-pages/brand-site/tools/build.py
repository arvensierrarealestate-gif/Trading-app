#!/usr/bin/env python3
"""Build index.html from index.src.html by inlining assets/photos/<name>.jpg
wherever the source uses {{PHOTO:<name>}}.  Run: python3 tools/build.py"""
import base64
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
src = open(os.path.join(ROOT, "index.src.html")).read()

def inline(m):
    path = os.path.join(ROOT, "assets", "photos", m.group(1) + ".jpg")
    with open(path, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()

out, n = re.subn(r"\{\{PHOTO:([a-z0-9-]+)\}\}", inline, src)
open(os.path.join(ROOT, "index.html"), "w").write(out)
print(f"index.html written: {len(out) // 1024} KB, {n} photo references inlined")
