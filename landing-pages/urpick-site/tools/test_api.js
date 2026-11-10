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
let calls = [], scenario = {}, tokenRequests = 0, tokenSerial = 0;
global.fetch = async (url, opts) => {
  const payload = JSON.parse(opts.body);
  if (/\/admin\/oauth\/access_token$/.test(url)) {
    tokenRequests++; calls.push({ url, headers: opts.headers, grant: payload });
    if (scenario.authFail) return { ok: false, status: 401, json: async () => ({ error: "invalid_client" }) };
    return { ok: true, status: 200, json: async () => ({ access_token: "shpat_dyn_" + (++tokenSerial), expires_in: scenario.expiresIn || 86399, scope: "read_customers,write_customers" }) };
  }
  calls.push({ url, headers: opts.headers, query: payload.query, variables: payload.variables });
  if (scenario.rejectToken && opts.headers["X-Shopify-Access-Token"] === scenario.rejectToken) return { ok: false, status: 401, json: async () => ({ errors: "[API] Invalid API key or access token" }) };
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

  // ── client-credentials grant (SHOPIFY_CLIENT_ID / SECRET / SHOP) ──
  delete process.env.SHOPIFY_ADMIN_TOKEN; process.env.SHOPIFY_CLIENT_ID = "cid_123"; process.env.SHOPIFY_CLIENT_SECRET = "csecret_456"; process.env.SHOPIFY_SHOP = "0b1qjx-f5.myshopify.com";
  handler._internals._resetTokenCache(); calls = []; scenario = {}; tokenRequests = 0;
  r = await call("POST", { email: "cc1@example.com", consent: true, source: "newsletter" });
  const grant = calls.find((c) => c.grant);
  check("client credentials: token requested once with grant_type client_credentials, then customer created", r.status === 200 && r.json.ok && tokenRequests === 1 && grant && grant.grant.grant_type === "client_credentials" && grant.grant.client_id === "cid_123" && grant.grant.client_secret === "csecret_456", JSON.stringify(r.json));
  check("client credentials: Admin calls use the granted token in the header", calls.filter((c) => c.query).every((c) => c.headers["X-Shopify-Access-Token"] === "shpat_dyn_1"));
  calls = [];
  r = await call("POST", { email: "cc2@example.com", consent: true, source: "newsletter" });
  check("second request reuses the cached token (no new grant)", r.status === 200 && tokenRequests === 1 && calls.every((c) => !c.grant));
  // renewal before expiry: age the cached token so under 5 minutes remain of its expires_in, then the next call must renew before using it
  handler._internals._resetTokenCache(); scenario = {}; calls = []; tokenRequests = 0;
  await call("POST", { email: "cc3@example.com", consent: true, source: "newsletter" });
  handler._internals._ageToken(4 * 60 * 1000); calls = [];
  r = await call("POST", { email: "cc4@example.com", consent: true, source: "newsletter" });
  check("token renewed automatically when inside the expiry margin (expires_in honoured)", r.status === 200 && tokenRequests === 2 && calls.filter((c) => c.query).every((c) => c.headers["X-Shopify-Access-Token"] === "shpat_dyn_" + tokenSerial));
  handler._internals._resetTokenCache(); scenario = { expiresIn: 120 }; calls = []; tokenRequests = 0;
  await call("POST", { email: "cc3b@example.com", consent: true, source: "newsletter" }); await call("POST", { email: "cc3c@example.com", consent: true, source: "newsletter" });
  check("a short-lived token is still cached for half its life rather than re-requested every call", tokenRequests === 1);
  // early revocation: Shopify answers 401 for the cached token -> renew once and retry transparently
  scenario = { rejectToken: "shpat_dyn_" + tokenSerial }; calls = []; const before = tokenRequests;
  r = await call("POST", { email: "cc5@example.com", consent: true, source: "newsletter" });
  check("401 on a cached token -> one renewal and a successful retry", r.status === 200 && r.json.ok && tokenRequests === before + 1);
  scenario = { authFail: true }; handler._internals._resetTokenCache(); calls = [];
  r = await call("POST", { email: "cc6@example.com", consent: true, source: "newsletter" });
  check("bad client secret -> 502 friendly error, secret not in the response", r.status === 502 && !/csecret|cid_123/.test(JSON.stringify(r.json)));
  check("secret and tokens never appear in any response body", !/csecret_456|shpat_/.test(JSON.stringify(r.json)));
  // consent rules
  scenario = { existing: { id: "gid://shopify/Customer/5", email: "u@example.com", tags: [], numberOfOrders: "0", emailMarketingConsent: { marketingState: "UNSUBSCRIBED" } } }; handler._internals._resetTokenCache(); calls = [];
  r = await call("POST", { email: "u@example.com", consent: true, source: "newsletter" });
  check("previously unsubscribed customer is never re-subscribed by a form; honest reason returned", r.status === 200 && r.json.subscribed === false && /previously unsubscribed/.test(r.json.reason) && !calls.some((c) => /ConsentUpdate/.test(c.query || "")));
  scenario = { existing: { id: "gid://shopify/Customer/6", email: "p@example.com", tags: [], numberOfOrders: "0", emailMarketingConsent: { marketingState: "NOT_SUBSCRIBED" } } }; calls = [];
  r = await call("POST", { email: "p@example.com", consent: true, source: "waitlist", product: "urpick-cat-cave" });
  check("not-yet-subscribed customer is subscribed with explicit consent and consentUpdatedAt", r.json.subscribed === true && calls.some((c) => /ConsentUpdate/.test(c.query || "") && c.variables.input.emailMarketingConsent.marketingState === "SUBSCRIBED" && c.variables.input.emailMarketingConsent.consentUpdatedAt));
  delete process.env.SHOPIFY_CLIENT_ID; delete process.env.SHOPIFY_CLIENT_SECRET; handler._internals._resetTokenCache();
  r = await call("POST", { email: "z@example.com", consent: true, source: "newsletter" });
  check("no credentials of either kind -> 503 not_configured", r.status === 503 && r.json.error === "not_configured");

  // ── diagnostics view ──
  process.env.SHOPIFY_CLIENT_ID = "cid_123"; process.env.SHOPIFY_CLIENT_SECRET = "csecret_456"; handler._internals._resetTokenCache(); scenario = {}; calls = [];
  const oldFetch = global.fetch;
  global.fetch = async (url, opts) => { const payload = JSON.parse(opts.body); if (/shop \{ name/.test(payload.query || "")) return { ok: true, status: 200, json: async () => ({ data: { shop: { name: "UrPick", myshopifyDomain: "0b1qjx-f5.myshopify.com" } } }) }; if (/customers\(first: 1\) \{ nodes \{ id/.test(payload.query || "")) return { ok: true, status: 200, json: async () => (scenario.denyCustomers ? { errors: [{ message: "Access denied for customers field. Required access: `read_customers` access scope. This app is not approved to access the Customer object." }] } : { data: { customers: { nodes: [] } } }) }; return oldFetch(url, opts); };
  const reqD = makeReq("GET", null); reqD.url = "/api/subscribe?diag=1"; let resD = makeRes(); await handler(reqD, resD); let d = JSON.parse(resD.body);
  check("diag: reports settings as booleans, auth ok with scope, shop name, customers access ok; no secrets", resD.statusCode === 200 && d.ok === true && d.settings.SHOPIFY_CLIENT_SECRET === true && d.auth.ok && d.shopQuery.shopName === "UrPick" && d.customersAccess.ok && !/csecret|shpat_/.test(resD.body), resD.body.slice(0, 300));
  scenario = { denyCustomers: true }; resD = makeRes(); await handler(reqD, resD); d = JSON.parse(resD.body);
  check("diag: customer access denied -> points at scopes / protected customer data", d.ok === false && d.customersAccess.ok === false && /Protected customer data/.test(d.nextStep));
  scenario = { authFail: true }; resD = makeRes(); await handler(reqD, resD); d = JSON.parse(resD.body);
  check("diag: bad credentials -> auth not ok with the OAuth error, no secret", d.auth.ok === false && d.auth.error === "invalid_client" && /rejected the client ID\/secret/.test(d.nextStep) && !/csecret/.test(resD.body));
  global.fetch = oldFetch; scenario = {};
  const reqP = makeReq("POST", { email: "q@example.com", consent: true, source: "newsletter" }); reqP.url = "/api/subscribe?diag=1"; const resP = makeRes(); await handler(reqP, resP);
  check("diag is GET-only: a POST with ?diag=1 is handled as a normal signup", resP.statusCode !== 200 || !/checkedAt/.test(resP.body));

  const fails = results.filter((x) => !x[1]);
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})();
