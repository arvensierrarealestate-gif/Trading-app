import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  alpacaGet,
  alpacaPost,
  alpacaDelete,
  AlpacaError,
  type AlpacaOrder,
  type AlpacaOrderRequest,
} from "@/lib/alpaca";

export const runtime = "nodejs";

const SIDES = ["buy", "sell"] as const;
const TYPES = ["market", "limit"] as const;
const TIF = ["day", "gtc", "ioc", "fok"] as const;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const orders = await alpacaGet<AlpacaOrder[]>("/orders?status=all&limit=20&direction=desc&nested=false");
    return NextResponse.json({ orders });
  } catch (err) {
    if (err instanceof AlpacaError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Alpaca request failed" }, { status: 502 });
  }
}

type Incoming = {
  symbol?: unknown;
  side?: unknown;
  type?: unknown;
  qty?: unknown;
  time_in_force?: unknown;
  limit_price?: unknown;
  stop_loss?: unknown;
  take_profit?: unknown;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Incoming;

  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!symbol) return NextResponse.json({ error: "Symbol is required" }, { status: 400 });

  const side = body.side as (typeof SIDES)[number];
  if (!SIDES.includes(side)) return NextResponse.json({ error: "Invalid side" }, { status: 400 });

  const type = body.type as (typeof TYPES)[number];
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Invalid order type" }, { status: 400 });

  const tif = body.time_in_force as (typeof TIF)[number];
  if (!TIF.includes(tif)) return NextResponse.json({ error: "Invalid time in force" }, { status: 400 });

  const qtyNum = Number(body.qty);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
    return NextResponse.json({ error: "Quantity must be a positive number" }, { status: 400 });
  }

  const order: AlpacaOrderRequest = {
    symbol,
    qty: String(qtyNum),
    side,
    type,
    time_in_force: tif,
  };

  if (type === "limit") {
    const priceNum = Number(body.limit_price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return NextResponse.json({ error: "Limit price must be a positive number" }, { status: 400 });
    }
    order.limit_price = String(priceNum);
  }

  // Optional bracket fields: a stop-loss (and/or take-profit) that fires
  // automatically once the parent fills.
  const stopNum = body.stop_loss != null ? Number(body.stop_loss) : NaN;
  const tpNum = body.take_profit != null ? Number(body.take_profit) : NaN;
  if (Number.isFinite(stopNum) && stopNum > 0) {
    order.order_class = "bracket";
    order.stop_loss = { stop_price: String(stopNum) };
    if (Number.isFinite(tpNum) && tpNum > 0) {
      order.take_profit = { limit_price: String(tpNum) };
    }
  }

  try {
    const placed = await alpacaPost<AlpacaOrder>("/orders", order);
    return NextResponse.json({ order: placed });
  } catch (err) {
    if (err instanceof AlpacaError) {
      return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 500 ? err.status : 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Order failed" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Order id is required" }, { status: 400 });

  try {
    await alpacaDelete(`/orders/${encodeURIComponent(id)}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AlpacaError) {
      return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 500 ? err.status : 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Cancel failed" }, { status: 502 });
  }
}
