import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import type { SOP, Trade } from "@/lib/types";
import { SOP_DEFAULTS } from "@/lib/types";

export default async function AppPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [sopRes, tradesRes, checksRes] = await Promise.all([
    supabase.from("sops").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("paper_trades").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
    supabase.from("go_live_checks").select("manual_checks").eq("user_id", user.id).maybeSingle(),
  ]);

  const sopRow = sopRes.data;
  const sop: SOP | null = sopRow
    ? {
        assets: sopRow.assets,
        tf: sopRow.tf,
        sessions: sopRow.sessions,
        entry_signals: sopRow.entry_signals,
        entry_confirm: sopRow.entry_confirm,
        entry_notes: sopRow.entry_notes,
        tp: sopRow.tp,
        sl: sopRow.sl,
        rr: sopRow.rr,
        risk: sopRow.risk,
        max_trades: sopRow.max_trades,
        drawdown: sopRow.drawdown,
        regimes: sopRow.regimes ?? "neutral, bull",
      }
    : null;

  const trades: Trade[] = (tradesRes.data ?? []).map((row) => ({
    id: row.id,
    asset: row.asset,
    dir: row.dir as Trade["dir"],
    outcome: row.outcome as Trade["outcome"],
    entry: row.entry_price ?? undefined,
    exit: row.exit_price ?? undefined,
    score: row.score,
    verdict: row.verdict as Trade["verdict"],
    grade: row.grade,
  }));

  const manualChecks: boolean[] = checksRes.data?.manual_checks ?? [false, false, false, false, false, false];

  return (
    <AppShell
      email={user.email ?? ""}
      initialSop={sop ?? SOP_DEFAULTS}
      hasSavedSop={!!sop}
      initialTrades={trades}
      initialManualChecks={manualChecks}
    />
  );
}
