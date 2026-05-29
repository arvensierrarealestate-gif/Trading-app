"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type TickerPanelState = {
  symbol: string | null;
  openTicker: (symbol: string) => void;
  closeTicker: () => void;
};

const Ctx = createContext<TickerPanelState | null>(null);

export function TickerPanelProvider({ children }: { children: ReactNode }) {
  const [symbol, setSymbol] = useState<string | null>(null);
  const openTicker = useCallback((s: string) => setSymbol(s.trim().toUpperCase()), []);
  const closeTicker = useCallback(() => setSymbol(null), []);
  return <Ctx.Provider value={{ symbol, openTicker, closeTicker }}>{children}</Ctx.Provider>;
}

export function useTickerPanel(): TickerPanelState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTickerPanel must be used inside <TickerPanelProvider>");
  return v;
}
