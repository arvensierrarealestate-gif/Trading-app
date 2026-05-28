// Shared per-user daily spend guard for the Anthropic-backed endpoints.
// Each "kind" maps to a row category in the api_usage table.

import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type UsageKind = "grade" | "recommend" | "verify" | "insight";

export const AI_DAILY_LIMITS: Record<UsageKind, number> = {
  grade: Number(process.env.GRADE_DAILY_LIMIT ?? "50"),
  recommend: Number(process.env.RECOMMEND_DAILY_LIMIT ?? "50"),
  verify: Number(process.env.VERIFY_DAILY_LIMIT ?? "10"),
  insight: Number(process.env.INSIGHT_DAILY_LIMIT ?? "100"),
};

const LABEL: Record<UsageKind, string> = {
  grade: "trade grading",
  recommend: "stop-loss recommendation",
  verify: "history verification",
  insight: "ticker insight",
};

export type LimitResult =
  | { ok: true; count: number; limit: number }
  | { ok: false; count: number; limit: number; message: string };

// Counts the user's calls of this kind since local midnight (server time) and
// reports whether they're under the daily cap. Fails open on a count error so a
// transient DB hiccup never blocks a legitimate request.
export async function checkDailyLimit(
  supabase: ServerClient,
  userId: string,
  kind: UsageKind,
): Promise<LimitResult> {
  const limit = AI_DAILY_LIMITS[kind];
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("api_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since.toISOString());

  if (error) return { ok: true, count: 0, limit }; // fail open

  const c = count ?? 0;
  if (c >= limit) {
    return {
      ok: false,
      count: c,
      limit,
      message: `Daily ${LABEL[kind]} limit reached (${limit} per day). Try again tomorrow.`,
    };
  }
  return { ok: true, count: c, limit };
}
