#!/usr/bin/env python3
"""Generate stand-in background images for every visual slot on the mock page.

These are deliberately abstract "room tone" images (wall/floor light, a soft
product silhouette, film grain). They exist so the layout can be judged with
real backgrounds in place, and they are replaced one-for-one by Canva exports
of the same filename in assets/.

Run:  python3 tools/make_standins.py
Requires Pillow.
"""
import json
import os
import random
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "standins")
os.makedirs(OUT, exist_ok=True)

# slot id -> (scene, width, height, label)
SLOTS = {
    "01-hero":        ("kitchen", 1200, 1500, "Hero lifestyle image"),
    "02-video":       ("kitchen", 1600, 1000, "Cat drinking video poster"),
    "02a-bowl":       ("studio",  1200, 1200, "Traditional bowl still"),
    "02b-fountain":   ("kitchen", 1200, 1200, "Same cat drinking from the fountain"),
    "03-product":     ("studio",  1200, 1500, "Product isolated image"),
    "05-tray":        ("macro",   1000, 1000, "Stainless tray close-up"),
    "07a-reservoir":  ("macro",   1000, 1000, "Reservoir access"),
    "07b-pump":       ("macro",   1000, 1000, "Pump removal"),
    "07c-rinse":      ("sink",    1000, 1000, "Rinsing at the sink"),
    "07d-reassembly": ("studio",  1000, 1000, "Reassembly"),
    "08-filter":      ("macro",   1000, 1000, "Filter close-up"),
    "09-kitchen":     ("kitchen", 1000, 1000, "Fountain in kitchen"),
    "10a-bedroom":    ("bedroom", 1000, 1000, "Fountain in bedroom"),
    "10b-living":     ("living",  1000, 1000, "Fountain in living room"),
    "10c-feeding":    ("kitchen", 1000, 1000, "Fountain at feeding station"),
    "11-flatlay":     ("flatlay", 1600, 1000, "What's-in-the-box flat lay"),
    "12-packaging":   ("studio",  1600, 1000, "Product packaging"),
}

PALETTE = {
    "kitchen": {"wall": (238, 234, 227), "wall2": (224, 219, 210), "floor": (206, 186, 160), "floor2": (188, 166, 138), "warm": 1.0},
    "bedroom": {"wall": (214, 208, 200), "wall2": (186, 180, 172), "floor": (168, 156, 144), "floor2": (140, 128, 116), "warm": 0.9},
    "living":  {"wall": (232, 229, 224), "wall2": (214, 211, 206), "floor": (196, 184, 168), "floor2": (176, 162, 146), "warm": 0.95},
    "studio":  {"wall": (246, 245, 243), "wall2": (232, 231, 229), "floor": (236, 235, 233), "floor2": (220, 219, 217), "warm": 1.0},
    "sink":    {"wall": (236, 238, 238), "wall2": (216, 220, 221), "floor": (200, 205, 208), "floor2": (180, 186, 190), "warm": 1.0},
    "macro":   {"wall": (222, 226, 229), "wall2": (176, 182, 187), "floor": (196, 201, 205), "floor2": (150, 156, 161), "warm": 1.0},
    "flatlay": {"wall": (243, 241, 237), "wall2": (232, 229, 224), "floor": (243, 241, 237), "floor2": (228, 225, 220), "warm": 1.0},
}


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(w, h, top, bottom, horizon):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        if y < horizon:
            c = lerp(top[0], top[1], y / max(1, horizon))
        else:
            c = lerp(bottom[0], bottom[1], (y - horizon) / max(1, h - horizon))
        for x in range(w):
            px[x, y] = c
    return img


def light_falloff(img, cx_frac=0.3, strength=0.22):
    """Window light from the upper-left: brighten near, darken far."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    r = int(max(w, h) * 0.9)
    cx, cy = int(w * cx_frac), int(h * 0.15)
    for i in range(12, 0, -1):
        rr = int(r * i / 12)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=int(255 * (1 - i / 12)))
    mask = mask.filter(ImageFilter.GaussianBlur(w // 6))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(dark, img, mask.point(lambda v: int(v * strength)))


def fountain(img, cx, base_y, height, warm=1.0):
    """A soft matte-white cylinder with a stainless top — the product's silhouette."""
    w, h = img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rw = int(height * 0.62)
    top_y = base_y - height
    # shadow
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - int(rw * 0.75), base_y - int(rw * 0.16), cx + int(rw * 0.75), base_y + int(rw * 0.18)], fill=(20, 18, 16, 70))
    sh = sh.filter(ImageFilter.GaussianBlur(int(rw * 0.12)))
    layer.alpha_composite(sh)
    # body
    body = (247, 246, 243) if warm >= 1 else (232, 230, 227)
    d.rounded_rectangle([cx - rw // 2, top_y + int(rw * 0.1), cx + rw // 2, base_y], radius=int(rw * 0.12), fill=body + (255,))
    # body shading (right side)
    shade = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shade).rectangle([cx + int(rw * 0.12), top_y + int(rw * 0.1), cx + rw // 2, base_y], fill=(90, 85, 80, 40))
    shade = shade.filter(ImageFilter.GaussianBlur(int(rw * 0.14)))
    layer.alpha_composite(shade)
    # stainless top ellipse
    ey = int(rw * 0.18)
    d.ellipse([cx - rw // 2, top_y, cx + rw // 2, top_y + 2 * ey], fill=(196, 201, 206, 255), outline=(150, 156, 162, 255), width=2)
    d.ellipse([cx - int(rw * 0.36), top_y + int(ey * 0.45), cx + int(rw * 0.36), top_y + int(ey * 1.55)], fill=(224, 228, 231, 255))
    # highlight streak
    d.line([cx - int(rw * 0.3), top_y + ey, cx + int(rw * 0.1), top_y + int(ey * 0.7)], fill=(250, 251, 252, 200), width=max(2, rw // 60))
    img = img.convert("RGBA")
    img.alpha_composite(layer)
    return img.convert("RGB")


def steel(w, h):
    """Brushed stainless macro: horizontal streaks + a soft highlight."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    rnd = random.Random(7)
    rows = [rnd.randint(-9, 9) for _ in range(h)]
    for y in range(h):
        base = 150 + int(70 * (1 - abs(y / h - 0.42) * 1.6))
        base = max(120, min(226, base + rows[y]))
        for x in range(w):
            v = base + int(10 * ((x / w) - 0.5))
            px[x, y] = (v - 4, v, v + 3)
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    return img


def grain(img, amount=6, seed=3):
    w, h = img.size
    rnd = random.Random(seed)
    noise = Image.effect_noise((w, h), amount).convert("RGB")
    return Image.blend(img, noise, 0.06)


def make(slot, scene, w, h):
    p = PALETTE[scene]
    if scene == "macro":
        img = steel(w, h)
    elif scene == "flatlay":
        img = gradient(w, h, (p["wall"], p["wall2"]), (p["floor"], p["floor2"]), h // 2)
        # a soft rectangle where the box contents would lie
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle([int(w * 0.16), int(h * 0.2), int(w * 0.84), int(h * 0.8)], radius=int(h * 0.05), fill=(255, 255, 255, 110))
        layer = layer.filter(ImageFilter.GaussianBlur(int(h * 0.02)))
        img = img.convert("RGBA"); img.alpha_composite(layer); img = img.convert("RGB")
    else:
        horizon = int(h * (0.62 if scene != "studio" else 0.7))
        img = gradient(w, h, (p["wall"], p["wall2"]), (p["floor"], p["floor2"]), horizon)
        img = light_falloff(img, strength=0.18 if scene != "bedroom" else 0.32)
        if scene != "sink":
            fh = int(h * (0.34 if h >= w else 0.46))
            img = fountain(img, int(w * (0.5 if scene == "studio" else 0.58)), int(h * 0.86), fh, p["warm"])
    img = grain(img)
    path = os.path.join(OUT, f"{slot}.jpg")
    img.save(path, "JPEG", quality=80, optimize=True, progressive=True)
    return path


if __name__ == "__main__":
    manifest = {}
    for slot, (scene, w, h, label) in SLOTS.items():
        path = make(slot, scene, w, h)
        manifest[slot] = {"file": f"assets/standins/{slot}.jpg", "canva_file": f"assets/{slot}.jpg", "label": label, "export_px": f"{w}x{h}", "scene": scene}
        print(f"{slot:16} {w}x{h}  {os.path.getsize(path)//1024} KB")
    with open(os.path.join(OUT, "..", "slots.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("wrote assets/slots.json")
