// Yahoo Finance uses dashes for crypto and dots for some indices, but our SOP
// inputs let users write "BTC/USD". Normalize once, here, so every Yahoo route
// gets the same fix without each route reinventing it.
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace("/", "-");
}
