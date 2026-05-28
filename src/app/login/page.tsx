"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [pending, setPending] = useState(false);

  // Catch implicit-flow tokens an email confirmation link can drop in the URL
  // fragment (#access_token=...). Set the session, scrub the URL so the token
  // never lingers, then continue into the app. Also surfaces ?error=auth_failed
  // bounced back from the server callback.
  useEffect(() => {
    const { hash, search } = window.location;

    if (new URLSearchParams(search).get("error") === "auth_failed") {
      setStatus({ kind: "err", msg: "That sign-in link was invalid or expired. Please sign in again." });
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (!hash || !hash.includes("access_token")) return;
    const params = new URLSearchParams(hash.slice(1));
    const errorDesc = params.get("error_description");
    if (errorDesc) {
      setStatus({ kind: "err", msg: errorDesc.replace(/\+/g, " ") });
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return;

    setPending(true);
    createClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        window.history.replaceState(null, "", window.location.pathname);
        if (error) {
          setStatus({ kind: "err", msg: error.message });
          setPending(false);
        } else {
          router.replace("/app");
          router.refresh();
        }
      });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setStatus(null);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name || email },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.push("/app");
          router.refresh();
          return;
        }
        setStatus({ kind: "ok", msg: "Account created. Check your email to confirm, then sign in." });
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/app");
        router.refresh();
      }
    } catch (err) {
      setStatus({ kind: "err", msg: errorMessage(err, "Authentication failed") });
    } finally {
      setPending(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setStatus(null);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-title">
          <span className="logo-dot" />
          TradeReady
        </div>
        <div className="auth-sub">
          {mode === "signin" ? "Sign in to continue your onboarding." : "Create an account to start building your SOP."}
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === "signin" ? "active" : ""}`}
            onClick={() => switchMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => switchMode("signup")}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={onSubmit}>
          {mode === "signup" && (
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
          )}
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="field" style={{ marginBottom: 18 }}>
            <label>Password</label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <button type="submit" className="btn primary" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
            {pending ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {status && <div className={`auth-msg ${status.kind}`}>{status.msg}</div>}
      </div>
    </div>
  );
}
