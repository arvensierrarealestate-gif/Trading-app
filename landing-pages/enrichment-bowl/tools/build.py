#!/usr/bin/env python3
"""Build index.html from index.src.html by embedding the stand-in images.

Stand-ins live in assets/standins/<slot>.jpg (currently frames cut from the
reference screen recording). They are embedded as data URIs so the single
file works anywhere; a real image saved as assets/<slot>.jpg overrides them.

Run:  python3 tools/build.py
"""
import base64
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
slots = json.load(open(os.path.join(ROOT, "assets", "slots.json")))
src = open(os.path.join(ROOT, "index.src.html")).read()

standins = {}
for sid, meta in slots.items():
    path = os.path.join(ROOT, meta["file"])
    if os.path.exists(path):
        with open(path, "rb") as f:
            standins[sid] = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()

out = src.replace("/*__SLOTS__*/{}", json.dumps({k: v["export_px"] for k, v in slots.items()}))
out = out.replace("/*__STANDINS__*/{}", json.dumps(standins))
open(os.path.join(ROOT, "index.html"), "w").write(out)
print(f"index.html written: {len(out) // 1024} KB, {len(standins)} stand-ins embedded")
