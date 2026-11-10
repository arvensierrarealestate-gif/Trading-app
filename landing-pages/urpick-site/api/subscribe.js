// UrPick — email capture endpoint (Vercel serverless function, Node 22, CommonJS).
// Served at /api/subscribe on the "urpick" Vercel project (root: landing-pages/urpick-site/site).
//
// What it does: puts a visitor's email into the Shopify customer list with email-marketing consent,
// tags it with where it came from, and tells the page whether the first-order offer applies.
// It never decides prices, never creates discounts and never exposes the Admin token to the browser.
//
// Request:  POST JSON { email, consent: true, source: "welcome-popup" | "newsletter" | "waitlist",
//                       percent?, product?, variant?, qty?, pets?, utm_source?, utm_medium?, utm_campaign?,
//                       utm_content?, utm_term?, fbclid?, ttclid?, landing? }
// Response: 200 { ok: true, eligible: boolean, reason?: string, existing: boolean, subscribed: true }
//           400 { ok: false, error: "invalid_email" | "invalid_source" | "consent_required", reason }
//           405 { ok: false, error: "method_not_allowed" }
//           503 { ok: false, error: "not_configured", reason }   ← SHOPIFY_ADMIN_TOKEN missing; pages fall back
//           502 { ok: false, error: "shopify_error", reason }
//
// Environment (Vercel → project urpick → Settings → Environment Variables; set for Production AND Preview):
//   SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET   the "UrPick website" app (Dev Dashboard). The function exchanges them for a short-lived
//                                               Admin access token with the client-credentials grant and renews it before it expires.
//   SHOPIFY_SHOP          store domain, e.g. 0b1qjx-f5.myshopify.com (default below)
//   SHOPIFY_ADMIN_TOKEN   alternative: a fixed Admin API token from a legacy custom app. Used only if the client credentials are absent.
//   SHOPIFY_API_VERSION   optional, default 2025-10
//   ALLOWED_ORIGINS       optional, comma-separated extra origins allowed to call this endpoint (same-origin always works)
// The secret and the tokens never leave this function: not in responses, not in logs.

"use strict";

function envClean(name) { return String(process.env[name] || "").trim().replace(/^["']+|["']+$/g, "").trim(); }   // tolerate pasted quotes/whitespace
const CLIENT_ID = () => envClean("SHOPIFY_CLIENT_ID"), CLIENT_SECRET = () => envClean("SHOPIFY_CLIENT_SECRET"), ADMIN_TOKEN = () => envClean("SHOPIFY_ADMIN_TOKEN");
const STORE = (envClean("SHOPIFY_SHOP") || envClean("SHOPIFY_STORE_DOMAIN") || "0b1qjx-f5.myshopify.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const SOURCES = { "welcome-popup": "welcome-popup", newsletter: "newsletter", waitlist: "waitlist" };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const OFFER_TAG = "welcome10";           // customer segment for the first-order offer (Urpick10off)
const USED_TAG = "welcome10-used";       // set by the store (Flow) once the offer has been redeemed
const SITE_TAG = "urpick-website";

// Light abuse protection: per-instance, per-IP throttle (serverless instances are short-lived; this is a speed bump, not a wall).
const hits = new Map();
function throttled(ip) {
  const now = Date.now(), windowMs = 60000, max = 12;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;                                            // same-origin fetches carry no Origin header
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const extra = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin === "https://" + host || origin === "http://" + host || extra.indexOf(origin) > -1;
  if (ok) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS"); }
  return ok;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") { try { return Promise.resolve(JSON.parse(req.body)); } catch (e) { return Promise.resolve({}); } }
  return new Promise((resolve) => {
    let data = ""; req.on("data", (c) => { data += c; if (data.length > 10000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

// ── Access token: client-credentials grant, cached per instance and renewed before `expires_in` runs out ──
const RENEW_MARGIN_MS = 5 * 60 * 1000;   // renew when less than 5 minutes remain (Shopify tokens last ~24 h)
let tokenCache = { value: null, expiresAt: 0, ttl: 0 };
let tokenInFlight = null;
function configured() { return !!((CLIENT_ID() && CLIENT_SECRET()) || ADMIN_TOKEN()); }
async function requestToken() {
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(), grant_type: "client_credentials" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("shopify auth: HTTP " + r.status + (j.error ? " " + j.error : ""));
  const ttl = Math.max(60, Number(j.expires_in) || 86400) * 1000;
  tokenCache = { value: j.access_token, expiresAt: Date.now() + ttl, ttl };
  return tokenCache.value;
}
async function accessToken(force) {
  if (!(CLIENT_ID() && CLIENT_SECRET())) return ADMIN_TOKEN();   // legacy fixed token
  const margin = Math.min(RENEW_MARGIN_MS, (tokenCache.ttl || 0) / 2);   // never renew on every call for unusually short-lived tokens
  if (!force && tokenCache.value && Date.now() < tokenCache.expiresAt - margin) return tokenCache.value;
  if (!tokenInFlight) tokenInFlight = requestToken().finally(() => { tokenInFlight = null; });
  return tokenInFlight;
}
async function shopify(query, variables, retried) {
  const token = await accessToken(false);
  const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (r.status === 401 && !retried && CLIENT_ID()) { tokenCache = { value: null, expiresAt: 0, ttl: 0 }; await accessToken(true); return shopify(query, variables, true); }   // token revoked or expired early: renew once
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) { const msg = (j.errors && j.errors[0] && j.errors[0].message) || `HTTP ${r.status}`; throw new Error("shopify: " + msg); }
  return j.data;
}

const Q_FIND = `query($q: String!) { customers(first: 1, query: $q) { nodes { id email tags numberOfOrders emailMarketingConsent { marketingState } } } }`;
const M_CREATE = `mutation($input: CustomerInput!) { customerCreate(input: $input) { customer { id tags numberOfOrders } userErrors { field message } } }`;
const M_TAGS = `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
const M_CONSENT = `mutation($input: CustomerEmailMarketingConsentUpdateInput!) { customerEmailMarketingConsentUpdate(input: $input) { userErrors { field message } } }`;

function attributionNote(b) {
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "ttclid", "landing"];
  const parts = keys.filter((k) => b[k]).map((k) => `${k}=${String(b[k]).slice(0, 120)}`);
  if (b.product) parts.push(`product=${String(b.product).slice(0, 60)}`);
  if (b.variant) parts.push(`variant=${String(b.variant).slice(0, 60)}`);
  if (b.qty) parts.push(`qty=${parseInt(b.qty, 10) || 1}`);
  if (Array.isArray(b.pets) && b.pets.length) parts.push(`pets=${b.pets.map((p) => String(p).slice(0, 20)).join("+")}`);
  return parts.length ? `UrPick website signup (${b.source}) · ${parts.join(" · ")}` : `UrPick website signup (${b.source})`;
}

function tagsFor(b, eligible) {
  const t = [SITE_TAG, "src:" + b.source];
  if (b.product) t.push("waitlist:" + String(b.product).slice(0, 60));
  if (Array.isArray(b.pets)) b.pets.forEach((p) => { const v = String(p).slice(0, 20); if (/^[a-z]+$/.test(v)) t.push("pet:" + v); });
  if (eligible) t.push(OFFER_TAG);
  return t;
}

// GET /api/subscribe?diag=1 — connection check for the store owner. Reports which settings are present and whether Shopify accepts
// the credentials and the customer scopes. Never returns a secret, token or customer record. Same per-IP throttle as signups.
async function diagnose() {
  const out = {
    ok: false, checkedAt: new Date().toISOString(), store: STORE, apiVersion: API_VERSION,
    settings: { SHOPIFY_CLIENT_ID: !!CLIENT_ID(), SHOPIFY_CLIENT_SECRET: !!CLIENT_SECRET(), SHOPIFY_SHOP: !!envClean("SHOPIFY_SHOP"), SHOPIFY_ADMIN_TOKEN: !!ADMIN_TOKEN() },
    clientId: { length: CLIENT_ID().length, startsWith: CLIENT_ID().slice(0, 4), looksLikeShopifyClientId: /^[0-9a-f]{32}$/.test(CLIENT_ID()), hadStrayCharacters: String(process.env.SHOPIFY_CLIENT_ID || "") !== CLIENT_ID() },
    clientSecret: { length: CLIENT_SECRET().length, hadStrayCharacters: String(process.env.SHOPIFY_CLIENT_SECRET || "") !== CLIENT_SECRET() },
    auth: null, shopQuery: null, customersAccess: null, nextStep: null,
  };
  if (!configured()) { out.nextStep = "Set SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET and SHOPIFY_SHOP in Vercel (Production and Preview), then redeploy."; return out; }
  try {
    if (CLIENT_ID() && CLIENT_SECRET()) {
      tokenCache = { value: null, expiresAt: 0, ttl: 0 };
      const r = await fetch(`https://${STORE}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(), grant_type: "client_credentials" }) });
      const j = await r.json().catch(() => ({}));
      out.auth = { ok: r.ok && !!j.access_token, httpStatus: r.status, error: j.error || null, errorDescription: j.error_description || null, scope: j.scope || null, expiresIn: j.expires_in || null };
      if (!out.auth.ok) {
        out.nextStep = j.error === "application_cannot_be_found"
          ? "Shopify has no app with this Client ID. In the Dev Dashboard open the app → Settings and compare: the Client ID is 32 characters of 0-9 and a-f (this one has " + CLIENT_ID().length + " and starts with \"" + CLIENT_ID().slice(0, 4) + "\"). If the app was created under a different Shopify organisation or Partner account than the store, Shopify will not find it either; the app must belong to the organisation that owns " + STORE + ". Correct the value in Vercel and redeploy."
          : (r.status === 401 || r.status === 400 ? "Shopify rejected the client ID/secret for this store (" + (j.error || r.status) + "): check the values in Vercel match the app's API credentials, that the app is installed on " + STORE + ", and that the store domain is right." : "Token endpoint unreachable or unexpected (HTTP " + r.status + ").");
        return out;
      }
      tokenCache = { value: j.access_token, expiresAt: Date.now() + Math.max(60, Number(j.expires_in) || 86400) * 1000, ttl: Math.max(60, Number(j.expires_in) || 86400) * 1000 };
    } else out.auth = { ok: true, mode: "fixed admin token" };
    try { const d = await shopify(`{ shop { name myshopifyDomain } }`); out.shopQuery = { ok: true, shopName: d.shop.name, domain: d.shop.myshopifyDomain }; }
    catch (e) { out.shopQuery = { ok: false, error: String(e.message).slice(0, 300) }; out.nextStep = "The token works for OAuth but Admin GraphQL calls fail: " + out.shopQuery.error; return out; }
    try { await shopify(`{ customers(first: 1) { nodes { id } } }`); out.customersAccess = { ok: true }; }
    catch (e) {
      const msg = String(e.message).slice(0, 300); out.customersAccess = { ok: false, error: msg };
      out.nextStep = /access denied|not approved|protected customer data|requires merchant approval|scope/i.test(msg)
        ? "The app cannot read customers yet. In the Shopify Dev Dashboard open the app → API access: (1) make sure the access scopes include read_customers and write_customers and reinstall the app on the store if you change them; (2) under Protected customer data access, request access (reason: store management / customer communication) and enable the Email field. Then run this check again."
        : "Customer query failed: " + msg;
      return out;
    }
    out.ok = true; out.nextStep = "Everything is connected. Signups will be saved to the Shopify customer list.";
  } catch (e) { out.nextStep = "Unexpected error: " + String(e.message).replace(/shp[a-z]*_[A-Za-z0-9]+/g, "[redacted]").slice(0, 200); }
  return out;
}

async function handler(req, res) {
  if (req.method === "OPTIONS") { cors(req, res); res.statusCode = 204; return res.end(); }
  if (!cors(req, res)) return json(res, 403, { ok: false, error: "origin_not_allowed" });
  if (req.method === "GET" && /(^|[?&])diag=1(&|$)/.test(String(req.url || ""))) {
    const ip0 = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    if (throttled(ip0)) return json(res, 429, { ok: false, error: "rate_limited" });
    return json(res, 200, await diagnose());
  }
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return json(res, 405, { ok: false, error: "method_not_allowed" }); }

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (throttled(ip)) return json(res, 429, { ok: false, error: "rate_limited", reason: "Too many attempts. Please try again in a minute." });

  const b = await readBody(req);
  const email = String(b.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json(res, 400, { ok: false, error: "invalid_email", reason: "Please enter a valid email address, like name@example.com." });
  if (!SOURCES[b.source]) return json(res, 400, { ok: false, error: "invalid_source", reason: "Unknown signup source." });
  if (b.consent !== true) return json(res, 400, { ok: false, error: "consent_required", reason: "Consent to receive emails is required." });
  if (!configured()) return json(res, 503, { ok: false, error: "not_configured", reason: "The email service is not connected yet." });

  const consentUpdatedAt = new Date().toISOString();
  const consent = { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN", consentUpdatedAt };

  try {
    const found = await shopify(Q_FIND, { q: `email:${JSON.stringify(email)}` });
    const existing = (found.customers.nodes || []).find((c) => (c.email || "").toLowerCase() === email) || null;

    if (!existing) {
      const eligible = true;
      const created = await shopify(M_CREATE, { input: { email, tags: tagsFor(b, eligible), note: attributionNote(b), emailMarketingConsent: consent } });
      const err = created.customerCreate.userErrors[0];
      if (err) throw new Error("shopify: " + err.message);
      return json(res, 200, { ok: true, eligible, existing: false, subscribed: true });
    }

    const hasOrders = Number(existing.numberOfOrders || 0) > 0;
    const used = (existing.tags || []).indexOf(USED_TAG) > -1;
    const eligible = !hasOrders && !used;
    const tags = tagsFor(b, eligible).filter((t) => (existing.tags || []).indexOf(t) === -1);
    if (tags.length) { const r1 = await shopify(M_TAGS, { id: existing.id, tags }); const e1 = r1.tagsAdd.userErrors[0]; if (e1) throw new Error("shopify: " + e1.message); }
    const state = existing.emailMarketingConsent && existing.emailMarketingConsent.marketingState;
    let subscribed = state === "SUBSCRIBED";
    if (state === "UNSUBSCRIBED") {
      // An explicit unsubscribe is never overridden by a form submission; the customer re-subscribes through an email footer or by contacting us.
      return json(res, 200, { ok: true, eligible, existing: true, subscribed: false, reason: "This email previously unsubscribed from UrPick emails, so we have not re-subscribed it. Email us if you would like to receive updates again." });
    }
    if (!subscribed) { const r2 = await shopify(M_CONSENT, { input: { customerId: existing.id, emailMarketingConsent: consent } }); const e2 = r2.customerEmailMarketingConsentUpdate.userErrors[0]; if (e2) throw new Error("shopify: " + e2.message); subscribed = true; }

    const reason = eligible ? undefined : (hasOrders
      ? "This email has already placed an order, so the first-order offer doesn’t apply. You’re on the list for launch news."
      : "This email has already used the first-order offer. You’re on the list for launch news.");
    return json(res, 200, { ok: true, eligible, existing: true, subscribed, reason });
  } catch (e) {
    try { console.error("[subscribe] " + String(e && e.message || e).replace(/shp[a-z]*_[A-Za-z0-9]+/g, "[redacted]").slice(0, 200)); } catch (_) {}   // message only, never the body, token or secret
    return json(res, 502, { ok: false, error: "shopify_error", reason: "We couldn’t save your email just now. Please try again in a moment." });
  }
}

module.exports = handler;
module.exports._internals = { tagsFor, attributionNote, EMAIL_RE, _resetTokenCache: () => { tokenCache = { value: null, expiresAt: 0, ttl: 0 }; }, _ageToken: (msLeft) => { if (tokenCache.value) tokenCache.expiresAt = Date.now() + msLeft; } };
