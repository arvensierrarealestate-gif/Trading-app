const ALPACA_BASE = process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets/v2";

function headers() {
  const id = process.env.ALPACA_KEY_ID;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!id || !secret) throw new Error("Alpaca credentials not configured");
  return {
    "APCA-API-KEY-ID": id,
    "APCA-API-SECRET-KEY": secret,
    "Content-Type": "application/json",
  };
}

export async function alpacaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ALPACA_BASE}${path}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`Alpaca ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export type AlpacaAccount = {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  buying_power: string;
  pattern_day_trader: boolean;
};
