"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import BrandLogo from "@/components/BrandLogo";

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
        <BrandLogo size={32} className="auth-brand" />
        <div className="auth-sub">
          {mode === "signin" ? "Sign in to terminal" : "Create your terminal access"}
        </div>

        <form onSubmit={onSubmit}>
          {mode === "signup" && (
            <div className="field auth-field">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
          )}
          <div className="field auth-field">
            <label>Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="trader@tradeready.io"
            />
          </div>
          <div className="field auth-field">
            <label>Password</label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
            />
          </div>
          <button type="submit" className="btn-signin" disabled={pending}>
            {pending ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="auth-foot">
          {mode === "signin" ? (
            <>No account yet? <button type="button" onClick={() => switchMode("signup")}>Create one</button></>
          ) : (
            <>Already have an account? <button type="button" onClick={() => switchMode("signin")}>Sign in</button></>
          )}
        </div>

        {status && <div className={`auth-msg ${status.kind}`}>{status.msg}</div>}
      </div>
    </div>
  );
}
