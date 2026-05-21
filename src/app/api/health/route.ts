import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { alpacaGet, type AlpacaAccount } from "@/lib/alpaca";

export const runtime = "nodejs";

type Check = { ok: boolean; detail: string; [k: string]: unknown };

function isSet(v: string | undefined): boolean {
  return !!v && !v.startsWith("REPLACE_ME") && !v.includes("[paste");
}

function checkEnv(): Check {
  const required: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ALPACA_KEY_ID: process.env.ALPACA_KEY_ID,
    ALPACA_SECRET_KEY: process.env.ALPACA_SECRET_KEY,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !isSet(v))
    .map(([k]) => k);
  return missing.length
    ? { ok: false, detail: `Missing or placeholder: ${missing.join(", ")}`, missing }
    : { ok: true, detail: "All required env vars set" };
}

async function checkSupabase(): Promise<Check> {
  if (!isSet(process.env.NEXT_PUBLIC_SUPABASE_URL) || !isSet(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    return { ok: false, detail: "Supabase URL/anon key not set" };
  }
  const tables = ["profiles", "sops", "paper_trades", "go_live_checks", "api_usage"];
  const result: Record<string, string> = {};
  let reachable = true;
  let authOk = true;
  try {
    const supabase = await createClient();
    for (const t of tables) {
      const { error } = await supabase.from(t).select("*", { count: "exact", head: true });
      if (!error) {
        result[t] = "ok";
      } else if (error.code === "42P01") {
        result[t] = "missing (run migrations)";
      } else if (/api key|jwt|unauthorized/i.test(error.message)) {
        result[t] = "auth error";
        authOk = false;
      } else {
        result[t] = error.message;
      }
    }
  } catch (e) {
    reachable = false;
    return { ok: false, detail: e instanceof Error ? e.message : "Supabase unreachable", tables: result };
  }
  const allOk = reachable && authOk && Object.values(result).every((v) => v === "ok");
  return {
    ok: allOk,
    detail: allOk ? "Reachable, all tables present" : "See per-table status",
    tables: result,
  };
}

async function checkAnthropic(): Promise<Check> {
  if (!isSet(process.env.ANTHROPIC_API_KEY)) return { ok: false, detail: "ANTHROPIC_API_KEY not set" };
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    await client.models.list(); // authenticated GET, costs no tokens
    return { ok: true, detail: "API key valid" };
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return { ok: false, detail: e.status === 401 ? "Invalid API key" : `Anthropic error ${e.status}` };
    }
    return { ok: false, detail: e instanceof Error ? e.message : "Anthropic check failed" };
  }
}

async function checkAlpaca(): Promise<Check> {
  if (!isSet(process.env.ALPACA_KEY_ID) || !isSet(process.env.ALPACA_SECRET_KEY)) {
    return { ok: false, detail: "Alpaca keys not set" };
  }
  try {
    const account = await alpacaGet<AlpacaAccount>("/account");
    return { ok: true, detail: `Account ${account.account_number} (${account.status})` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "Alpaca check failed" };
  }
}

export async function GET(req: Request) {
  // Open in development; require a token in production to avoid abuse.
  if (process.env.NODE_ENV === "production") {
    const token = new URL(req.url).searchParams.get("token");
    if (!process.env.HEALTH_CHECK_TOKEN || token !== process.env.HEALTH_CHECK_TOKEN) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const [env, supabase, anthropic, alpaca] = await Promise.all([
    Promise.resolve(checkEnv()),
    checkSupabase(),
    checkAnthropic(),
    checkAlpaca(),
  ]);

  const checks = { env, supabase, anthropic, alpaca };
  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
