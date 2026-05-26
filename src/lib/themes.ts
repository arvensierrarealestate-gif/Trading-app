export const THEMES = [
  { id: "dark-terminal", label: "Dark terminal", swatch: "#00d4aa" },
  { id: "robinhood-dark", label: "Robinhood dark", swatch: "#ff6b35" },
  { id: "light-pro", label: "Light professional", swatch: "#1e3a8a" },
  { id: "bloomberg-dark", label: "Bloomberg dark", swatch: "#ff8a00" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEMES as readonly { id: string }[]).some((t) => t.id === v);
}
