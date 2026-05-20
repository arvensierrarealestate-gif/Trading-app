import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  alpacaGet,
  alpacaDelete,
  AlpacaError,
  type AlpacaPosition,
  type AlpacaOrder,
} from "@/lib/alpaca";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const positions = await alpacaGet<AlpacaPosition[]>("/positions");
    return NextResponse.json({ positions });
  } catch (err) {
    if (err instanceof AlpacaError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Alpaca request failed" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const symbol = new URL(req.url).searchParams.get("symbol")?.trim();
  if (!symbol) return NextResponse.json({ error: "Symbol is required" }, { status: 400 });

  try {
    const order = await alpacaDelete<AlpacaOrder>(`/positions/${encodeURIComponent(symbol)}`);
    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof AlpacaError) {
      return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 500 ? err.status : 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Close failed" }, { status: 502 });
  }
}
