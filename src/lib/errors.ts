// Extract a human-readable message from anything thrown — including Supabase
// PostgrestError objects, which are NOT instances of Error and so slip past the
// common `e instanceof Error ? e.message : "..."` pattern (hiding the real
// reason behind a generic string).
export function errorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    // PostgrestError: { message, details, hint, code }
    const parts = [o.message, o.details, o.hint].filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );
    if (parts.length) {
      const code = typeof o.code === "string" && o.code ? ` [${o.code}]` : "";
      return parts.join(" — ") + code;
    }
  }
  return fallback;
}
