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

export class AlpacaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function alpacaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ALPACA_BASE}${path}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new AlpacaError(res.status, await res.text());
  return res.json() as Promise<T>;
}

export async function alpacaPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ALPACA_BASE}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new AlpacaError(res.status, await res.text());
  return res.json() as Promise<T>;
}

export async function alpacaDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${ALPACA_BASE}${path}`, {
    method: "DELETE",
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new AlpacaError(res.status, await res.text());
  return res.json() as Promise<T>;
}

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";

export type AlpacaOrderRequest = {
  symbol: string;
  qty: string;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  limit_price?: string;
};

export type AlpacaOrder = {
  id: string;
  symbol: string;
  qty: string | null;
  filled_qty: string;
  side: string;
  type: string;
  time_in_force: string;
  limit_price: string | null;
  status: string;
  submitted_at: string;
  filled_avg_price: string | null;
};

export type AlpacaPosition = {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price: string | null;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
};

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
