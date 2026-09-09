#!/usr/bin/env python3
"""One-off patch: turn the labeled placeholders in index.html into image slots.

- tags each .ph with data-slot / data-export
- wraps its labels in .ph-cap
- injects slot CSS, inline stand-in backgrounds (base64 of assets/*.jpg) and the
  drop-to-replace / save-to-artifact script.
"""
import base64, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
p = os.path.join(ROOT, "index.html")
s = open(p).read()
slots = json.load(open(os.path.join(ROOT, "assets", "slots.json")))

# token after "Placeholder " -> slot id
by_token = {sid.split("-")[0]: sid for sid in slots}

def tag(m):
    open_tag, children = m.group(1), m.group(2)
    tok = re.search(r"Placeholder (\w+)", children).group(1)
    sid = by_token[tok]
    open_tag = open_tag[:-1] + f' data-slot="{sid}" data-export="{slots[sid]["export_px"]}">'
    return f'{open_tag}<div class="ph-cap">{children.strip()}</div><button type="button" class="ph-drop" aria-label="Replace image"></button></div>'

pat = re.compile(r'(<div class="ph[^"]*">)\s*((?:<div class="ph-(?:id|name|brief)">.*?</div>\s*)+)</div>', re.S)
s, n = pat.subn(tag, s)
assert n == len(slots), (n, len(slots))

CSS = """
  /* ───────────── Image slots ───────────── */
  .ph { background-size: cover; background-position: center; align-content: end; justify-items: start; text-align: left; padding: 12px; }
  .ph::before { display: none; }
  .ph-cap { background: color-mix(in srgb, var(--surface) 82%, transparent); backdrop-filter: blur(8px); border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); border-radius: 12px; padding: 10px 12px; max-width: 100%; }
  .ph .ph-id { margin-bottom: 4px; }
  .ph .ph-name { font-size: 15px; }
  .ph .ph-brief { font-size: 12.5px; margin-top: 4px; }
  .hero .ph .ph-name, .solution .ph .ph-name { font-size: 17px; }
  .ph.has-img .ph-cap { display: none; }
  body.notes .ph.has-img .ph-cap { display: block; padding: 5px 8px; }
  body.notes .ph.has-img .ph-name, body.notes .ph.has-img .ph-brief { display: none; }
  .ph-drop { display: none; position: absolute; top: 10px; right: 10px; font-family: var(--mono); font-size: 11px; letter-spacing: .04em; background: var(--note-bg); color: var(--note-ink); border: 1px solid var(--note-line); border-radius: 999px; padding: 6px 10px; cursor: pointer; max-width: calc(100% - 20px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  body.notes .ph-drop { display: block; }
  .ph-drop:hover { background: var(--note-ink); color: var(--note-bg); }
  .ph.over { outline: 3px dashed var(--water); outline-offset: -6px; }
  .ph.saving .ph-drop { opacity: .7; cursor: progress; }
  .cordless .ph-cap { background: color-mix(in srgb, #1B1D1F 70%, transparent); border-color: rgba(255,255,255,.12); }
  .cordless .ph .ph-id { color: var(--steel); }
  .mockbar .imgcount { margin-left: auto; }
"""
s = s.replace("\n</style>", CSS + "</style>", 1)

# stand-in data URIs
standins = {}
for sid, meta in slots.items():
    with open(os.path.join(ROOT, meta["file"]), "rb") as f:
        standins[sid] = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()

JS = """
<script>
  // ── Image slots: assets/<slot>.jpg from Canva, else the inline stand-in ──
  // Workflow: export from Canva at the size shown on the slot's button, then
  // drop the file onto the slot (or click the button). On the published
  // artifact the file is saved as assets/<slot>.jpg for every viewer; when
  // opened from the repo it previews only — save the file into assets/ by
  // the same name and it is picked up on the next load.
  var SLOTS = %(slots)s;
  var STANDIN = %(standins)s;
  var artifactNS = null, artifactReady = null;
  if (window.claude && typeof window.claude.use === "function") {
    artifactReady = window.claude.use("artifact").then(function (ns) { artifactNS = ns; return ns; }).catch(function () { return null; });
  } else { artifactReady = Promise.resolve(null); }

  var slotEls = Array.prototype.slice.call(document.querySelectorAll("[data-slot]"));
  var filled = {};
  function updateCount() {
    var n = Object.keys(filled).filter(function (k) { return filled[k]; }).length;
    var el = document.getElementById("imgcount"); if (el) el.textContent = "Images from Canva: " + n + " / " + slotEls.length;
  }
  function paint(el, url) {
    var sid = el.getAttribute("data-slot");
    var layers = [];
    if (url) layers.push('url("' + url + '")');
    layers.push('url("' + STANDIN[sid] + '")');
    el.style.backgroundImage = layers.join(", ");
    el.classList.toggle("has-img", !!url);
    filled[sid] = !!url; updateCount();
    var b = el.querySelector(".ph-drop");
    if (b) b.textContent = (url ? "Replace" : "Drop Canva export") + " · " + el.getAttribute("data-export");
  }
  function probe(el) {
    var sid = el.getAttribute("data-slot"), src = "assets/" + sid + ".jpg";
    paint(el, null);
    var im = new Image();
    im.onload = function () { paint(el, src + "?v=" + Date.now()); };
    im.onerror = function () { paint(el, null); };
    im.src = src;
  }
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var im = new Image(); var u = URL.createObjectURL(file);
      im.onload = function () {
        var max = 1600, w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error("encode failed")); }, "image/jpeg", 0.85);
      };
      im.onerror = function () { reject(new Error("not an image")); };
      im.src = u;
    });
  }
  function status(el, text, ms) {
    var b = el.querySelector(".ph-drop"); if (!b) return; var keep = b.textContent; b.textContent = text;
    if (ms) setTimeout(function () { if (b.textContent === text) b.textContent = keep; }, ms);
  }
  function place(el, file) {
    if (!file || !/^image\\//.test(file.type)) { status(el, "Drop a PNG or JPG", 2500); return; }
    var sid = el.getAttribute("data-slot");
    el.classList.add("saving"); status(el, "Preparing…");
    shrink(file).then(function (blob) {
      paint(el, URL.createObjectURL(blob));
      return artifactReady.then(function (ns) {
        if (!ns) { status(el, "Preview only · save as assets/" + sid + ".jpg", 6000); return; }
        var files = {}; files["assets/" + sid + ".jpg"] = { content: blob, contentType: "image/jpeg" };
        status(el, "Saving…");
        return ns.publish(files).then(function () { status(el, "Saved for everyone", 3000); })
          .catch(function (e) {
            var code = e && e.code;
            if (code === "conflict") status(el, "Page updated elsewhere, reloading…");
            else if (code === "not_writer" || code === "not_granted") status(el, "Preview only · you can't save this page", 6000);
            else if (code === "capability_disabled") status(el, "Preview only · saving unavailable here", 6000);
            else status(el, "Could not save: " + (e && e.message || code || "error"), 6000);
          });
      });
    }).catch(function (e) { status(el, e.message, 3000); }).finally(function () { el.classList.remove("saving"); });
  }
  var picker = document.createElement("input"); picker.type = "file"; picker.accept = "image/*"; picker.hidden = true; document.body.appendChild(picker);
  var pickTarget = null;
  picker.addEventListener("change", function () { if (pickTarget && picker.files[0]) place(pickTarget, picker.files[0]); picker.value = ""; });
  slotEls.forEach(function (el) {
    probe(el);
    var b = el.querySelector(".ph-drop");
    if (b) b.addEventListener("click", function (ev) { ev.preventDefault(); pickTarget = el; picker.click(); });
    el.addEventListener("dragover", function (ev) { if (!document.body.classList.contains("notes")) return; ev.preventDefault(); el.classList.add("over"); });
    el.addEventListener("dragleave", function () { el.classList.remove("over"); });
    el.addEventListener("drop", function (ev) { if (!document.body.classList.contains("notes")) return; ev.preventDefault(); el.classList.remove("over"); place(el, ev.dataTransfer.files[0]); });
  });
</script>
""" % {"slots": json.dumps({k: v["export_px"] for k, v in slots.items()}), "standins": json.dumps(standins)}

s = s.rstrip() + "\n" + JS
# counter chip in the mock bar
s = s.replace('</button>\n    </span>\n  </div>\n</div>', '</button>\n    </span>\n    <span class="imgcount" id="imgcount">Images from Canva: 0 / %d</span>\n  </div>\n</div>' % len(slots), 1)
open(p, "w").write(s)
print("patched", n, "slots; size", len(s) // 1024, "KB")
