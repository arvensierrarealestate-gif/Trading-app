import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { alpacaGet, type AlpacaAccount } from "@/lib/alpaca";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const account = await alpacaGet<AlpacaAccount>("/account");
    return NextResponse.json({ account });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Alpaca request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
