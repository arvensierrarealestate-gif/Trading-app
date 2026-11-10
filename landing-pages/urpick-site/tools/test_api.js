// Unit tests for api/subscribe.js with a stubbed Shopify Admin API. Run: node tools/test_api.js
"use strict";
const path = require("path");
const handler = require(path.join(__dirname, "..", "api", "subscribe.js"));

let results = [];
function check(name, ok, info) { results.push([name, !!ok]); console.log((ok ? "PASS " : "FAIL ") + name + (info && !ok ? "  " + info : "")); }

function makeReq(method, body, headers) {
  return { method, headers: Object.assign({ host: "trading-app-3k96.vercel.app", "x-forwarded-for": "203.0.113." + Math.floor(Math.random() * 250) }, headers || {}), body, socket: { remoteAddress: "127.0.0.1" } };
}
function makeRes() {
  const r = { statusCode: 200, headers: {}, body: "" };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = (s) => { r.body = s || ""; r.ended = true; };
  return r;
}
async function call(method, body, headers) { const req = makeReq(method, body, headers), res = makeRes(); await handler(req, res); let j = null; try { j = JSON.parse(res.body); } catch (e) {} return { status: res.statusCode, json: j, headers: res.headers }; }

// Stub Shopify: records calls, answers by query shape.
let calls = [], scenario = {};
global.fetch = async (url, opts) => {
  const payload = JSON.parse(opts.body);
  calls.push({ url, headers: opts.headers, query: payload.query, variables: payload.variables });
  if (scenario.http) return { ok: false, status: scenario.http, json: async () => ({ errors: [{ message: "boom" }] }) };
  const q = payload.query;
  let data = {};
  if (/customers\(first/.test(q)) data = { customers: { nodes: scenario.existing ? [scenario.existing] : [] } };
  else if (/customerCreate/.test(q)) data = { customerCreate: { customer: { id: "gid://shopify/Customer/1", tags: payload.variables.input.tags, numberOfOrders: "0" }, userErrors: scenario.createError ? [{ field: ["email"], message: scenario.createError }] : [] } };
  else if (/tagsAdd/.test(q)) data = { tagsAdd: { userErrors: [] } };
  else if (/customerEmailMarketingConsentUpdate/.test(q)) data = { customerEmailMarketingConsentUpdate: { userErrors: [] } };
  return { ok: true, status: 200, json: async () => ({ data }) };
};

(async () => {
  process.env.SHOPIFY_ADMIN_TOKEN = "";
  let r = await call("GET", {});
  check("GET is refused with 405", r.status === 405 && r.json.error === "method_not_allowed");
  r = await call("POST", { email: "nope", consent: true, source: "newsletter" });
  check("invalid email -> 400 invalid_email", r.status === 400 && r.json.error === "invalid_email");
  r = await call("POST", { email: "a@b.co", consent: true, source: "spam" });
  check("unknown source -> 400 invalid_source", r.status === 400 && r.json.error === "invalid_source");
  r = await call("POST", { email: "a@b.co", consent: false, source: "newsletter" });
  check("missing consent -> 400 consent_required", r.status === 400 && r.json.error === "consent_required");
  r = await call("POST", { email: "a@b.co", consent: true, source: "welcome-popup" });
  check("no token -> 503 not_configured (pages fall back to local save)", r.status === 503 && r.json.error === "not_configured" && calls.length === 0);
  r = await call("POST", { email: "a@b.co", consent: true, source: "newsletter" }, { origin: "https://evil.example" });
  check("foreign origin -> 403", r.status === 403 && r.json.error === "origin_not_allowed");
  r = await call("POST", { email: "a@b.co", consent: true, source: "newsletter" }, { origin: "https://trading-app-3k96.vercel.app" });
  check("same-site origin accepted with CORS headers", r.status === 503 && r.headers["access-control-allow-origin"] === "https://trading-app-3k96.vercel.app");

  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_test";
  calls = []; scenario = {};
  r = await call("POST", { email: " Pat@Example.com ", consent: true, source: "welcome-popup", percent: 10, utm_source: "tiktok", fbclid: "f1", landing: "/products/cozy-cat-cave" });
  const create = calls.find((c) => /customerCreate/.test(c.query));
  check("new email: looked up then created, lower-cased", r.status === 200 && r.json.ok && r.json.eligible === true && r.json.existing === false && create && create.variables.input.email === "pat@example.com", JSON.stringify(r.json));
  check("new email: subscribed with single opt-in consent and a timestamp", create && create.variables.input.emailMarketingConsent.marketingState === "SUBSCRIBED" && create.variables.input.emailMarketingConsent.marketingOptInLevel === "SINGLE_OPT_IN" && /^\d{4}-/.test(create.variables.input.emailMarketingConsent.consentUpdatedAt));
  check("new email: tagged urpick-website, src:welcome-popup, welcome10; attribution in the note", create && ["urpick-website", "src:welcome-popup", "welcome10"].every((t) => create.variables.input.tags.indexOf(t) > -1) && /utm_source=tiktok/.test(create.variables.input.note) && /fbclid=f1/.test(create.variables.input.note));
  check("token sent in the header, never in the body", calls.every((c) => c.headers["X-Shopify-Access-Token"] === "shpat_test" && !/shpat_test/.test(JSON.stringify(c.variables))));
  check("store domain and API version in the URL", /0b1qjx-f5\.myshopify\.com\/admin\/api\/2025-10\/graphql\.json$/.test(calls[0].url));

  calls = []; scenario = { existing: { id: "gid://shopify/Customer/9", email: "pat@example.com", tags: ["urpick-website"], numberOfOrders: "2", emailMarketingConsent: { marketingState: "NOT_SUBSCRIBED" } } };
  r = await call("POST", { email: "pat@example.com", consent: true, source: "welcome-popup" });
  check("existing customer with orders: not eligible, friendly reason, still subscribed", r.status === 200 && r.json.ok && r.json.eligible === false && /already placed an order/.test(r.json.reason) && r.json.subscribed === true, JSON.stringify(r.json));
  const tagsCall = calls.find((c) => /tagsAdd/.test(c.query)), consentCall = calls.find((c) => /customerEmailMarketingConsentUpdate/.test(c.query));
  check("existing customer: only new tags added, no welcome10, consent updated to SUBSCRIBED", tagsCall && tagsCall.variables.tags.indexOf("src:welcome-popup") > -1 && tagsCall.variables.tags.indexOf("welcome10") === -1 && tagsCall.variables.tags.indexOf("urpick-website") === -1 && consentCall && consentCall.variables.input.emailMarketingConsent.marketingState === "SUBSCRIBED");

  calls = []; scenario = { existing: { id: "gid://shopify/Customer/9", email: "pat@example.com", tags: ["urpick-website", "src:newsletter", "welcome10"], numberOfOrders: "0", emailMarketingConsent: { marketingState: "SUBSCRIBED" } } };
  r = await call("POST", { email: "pat@example.com", consent: true, source: "newsletter", pets: ["cat"] });
  check("already subscribed, no orders: eligible, pet tag added, no consent call", r.json.eligible === true && calls.some((c) => /tagsAdd/.test(c.query) && c.variables.tags.join() === "pet:cat") && !calls.some((c) => /ConsentUpdate/.test(c.query)));

  calls = []; scenario = { existing: { id: "gid://shopify/Customer/9", email: "pat@example.com", tags: ["welcome10-used"], numberOfOrders: "0", emailMarketingConsent: { marketingState: "SUBSCRIBED" } } };
  r = await call("POST", { email: "pat@example.com", consent: true, source: "welcome-popup" });
  check("offer already used (tag): not eligible with the used reason", r.json.eligible === false && /already used/.test(r.json.reason));

  calls = []; scenario = {};
  r = await call("POST", { email: "w@example.com", consent: true, source: "waitlist", product: "urpick-cat-cave", variant: "cow-print", qty: 2, ttclid: "t1" });
  const c2 = calls.find((c) => /customerCreate/.test(c.query));
  check("waitlist: product tag and variant/qty/ttclid recorded", c2 && c2.variables.input.tags.indexOf("waitlist:urpick-cat-cave") > -1 && /variant=cow-print/.test(c2.variables.input.note) && /qty=2/.test(c2.variables.input.note) && /ttclid=t1/.test(c2.variables.input.note));

  calls = []; scenario = { http: 401 };
  r = await call("POST", { email: "x@example.com", consent: true, source: "newsletter" });
  check("Shopify error -> 502 with a friendly reason and no token leak", r.status === 502 && r.json.error === "shopify_error" && !/shpat/.test(r.json.reason));

  calls = []; scenario = { createError: "Email has already been taken" };
  r = await call("POST", { email: "y@example.com", consent: true, source: "newsletter" });
  check("userErrors from Shopify -> 502", r.status === 502);

  const ip = "198.51.100.7"; let last;
  for (let i = 0; i < 13; i++) last = await call("POST", { email: "r@example.com", consent: true, source: "newsletter" }, { "x-forwarded-for": ip });
  check("13th request from one IP in a minute -> 429", last.status === 429);

  const fails = results.filter((x) => !x[1]);
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})();
