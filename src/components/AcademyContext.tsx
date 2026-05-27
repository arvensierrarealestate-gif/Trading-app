"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type AcademyState = {
  open: boolean;
  anchorTermId: string | null;
  openAcademy: (anchorTermId?: string | null) => void;
  closeAcademy: () => void;
};

const Ctx = createContext<AcademyState | null>(null);

export function AcademyProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [anchorTermId, setAnchorTermId] = useState<string | null>(null);

  const openAcademy = useCallback((anchor?: string | null) => {
    setAnchorTermId(anchor ?? null);
    setOpen(true);
  }, []);
  const closeAcademy = useCallback(() => {
    setOpen(false);
    setAnchorTermId(null);
  }, []);

  return <Ctx.Provider value={{ open, anchorTermId, openAcademy, closeAcademy }}>{children}</Ctx.Provider>;
}

export function useAcademy(): AcademyState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAcademy must be used inside <AcademyProvider>");
  return v;
}
