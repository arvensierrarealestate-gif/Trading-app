import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Shared auth check for /api/cowork-* routes. Accepts either:
//   1. an authenticated browser session (the cookie that the logged-in app
//      already carries — same as every other authenticated route in the app), or
//   2. an Authorization: Bearer <COWORK_API_TOKEN> header for headless /
//      scheduled use (cron, Zapier, integrations).
//
// Header check happens FIRST so the cron path doesn't try to read cookies that
// don't exist. Falls through to the session check on no/invalid header.
//
// Returns { ok: true, source, userId? } on success and a ready-to-return
// 401 NextResponse on failure — callers just `if (!auth.ok) return auth.response;`
export type CoworkAuth =
  | { ok: true; source: "token" }
  | { ok: true; source: "session"; userId: string }
  | { ok: false; response: NextResponse };

export async function authorizeCowork(req: Request): Promise<CoworkAuth> {
  const expected = process.env.COWORK_API_TOKEN;
  const header = req.headers.get("authorization") ?? "";
  if (expected && header.startsWith("Bearer ")) {
    const provided = header.slice("Bearer ".length).trim();
    // Constant-time string compare to avoid leaking length/prefix via timing.
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { ok: true, source: "token" };
    }
    // Bearer header was supplied but didn't match — refuse cleanly rather than
    // silently falling through to session auth, which would let an attacker
    // probe both paths from a single request.
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { ok: true, source: "session", userId: user.id };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
