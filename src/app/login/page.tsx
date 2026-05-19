"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setStatus(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setStatus({ kind: "ok", msg: "Check your inbox for a sign-in link." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      setStatus({ kind: "err", msg });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-title">
          <span className="logo-dot" />
          TradeReady
        </div>
        <div className="auth-sub">Sign in with a magic link — no passwords.</div>
        <form onSubmit={onSubmit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Email</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <button type="submit" className="btn primary" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
            {pending ? "Sending…" : "Send magic link"}
          </button>
        </form>
        {status && <div className={`auth-msg ${status.kind}`}>{status.msg}</div>}
      </div>
    </div>
  );
}
