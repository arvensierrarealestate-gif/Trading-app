import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import type { SOP, Trade, TradingMode, TraderStats } from "@/lib/types";
import { SOP_DEFAULTS } from "@/lib/types";
import { isThemeId, type ThemeId } from "@/lib/themes";

export default async function AppPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [sopRes, tradesRes, checksRes, profileRes, statsRes] = await Promise.all([
    supabase.from("sops").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("paper_trades").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
    supabase.from("go_live_checks").select("manual_checks").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("trading_mode, verified, theme").eq("id", user.id).maybeSingle(),
    supabase.from("trader_stats").select("*").eq("user_id", user.id).maybeSingle(),
  ]);

  const initialMode = (profileRes.data?.trading_mode ?? null) as TradingMode | null;
  const initialVerified = !!profileRes.data?.verified;
  const themeRaw = profileRes.data?.theme;
  const initialTheme: ThemeId = isThemeId(themeRaw) ? themeRaw : "dark-terminal";
  const sr = statsRes.data;
  const initialStats: TraderStats | null = sr
    ? {
        total_trades: sr.total_trades,
        win_rate: sr.win_rate,
        avg_win: sr.avg_win,
        avg_loss: sr.avg_loss,
        max_single_loss: sr.max_single_loss,
        max_drawdown: sr.max_drawdown,
        primary_assets: sr.primary_assets,
        avg_hold_time: sr.avg_hold_time,
      }
    : null;

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
        strategy_type: sopRow.strategy_type ?? "custom",
      }
    : null;
  const sopUpdatedAt: string | null = sopRow?.updated_at ?? null;

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
    stop_loss: row.stop_loss_price ?? undefined,
    protection_score: row.protection_score ?? 0,
    stop_loss_set: row.stop_loss_set ?? false,
    stop_loss_placement: row.stop_loss_placement ?? 0,
    position_size_ok: row.position_size_ok ?? false,
    strategy_type: row.strategy_type ?? null,
  }));

  const manualChecks: boolean[] = checksRes.data?.manual_checks ?? [false, false, false, false, false, false];

  return (
    <AppShell
      email={user.email ?? ""}
      initialSop={sop ?? SOP_DEFAULTS}
      hasSavedSop={!!sop}
      initialSopUpdatedAt={sopUpdatedAt}
      initialTrades={trades}
      initialManualChecks={manualChecks}
      initialMode={initialMode}
      initialVerified={initialVerified}
      initialStats={initialStats}
      initialTheme={initialTheme}
    />
  );
}
