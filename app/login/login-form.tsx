"use client";
import { useState } from "react";
import { Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";

class SignInTimeout extends Error {}

async function withSignInTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SignInTimeout("Google sign-in did not finish. Reload this page and try again. If you opened the link inside another app, open it directly in Chrome or Safari.")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export default function LoginForm({ config }: { config: { apiKey: string; authDomain: string; projectId: string } | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  async function signIn() {
    if (!config) return;
    setBusy(true); setError("");
    try {
      const [{ initializeApp, getApps }, { getAuth, GoogleAuthProvider, signInWithPopup, setPersistence, inMemoryPersistence, signOut }] = await withSignInTimeout(Promise.all([import("firebase/app"), import("firebase/auth")]), 20000);
      const app = getApps()[0] ?? initializeApp(config);
      const auth = getAuth(app);
      await withSignInTimeout(setPersistence(auth, inMemoryPersistence), 20000);
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
      const credential = await withSignInTimeout(signInWithPopup(auth, provider), 120000);
      try {
        const idToken = await credential.user.getIdToken();
        const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json", "X-Pathways-Client": "1" }, body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(20000) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not sign in.");
        window.location.assign("/");
      } finally { await signOut(auth); }
    } catch (error) {
      // An unfinished SDK popup operation cannot be cancelled safely. Reloading
      // discards it instead of starting a second sign-in attempt alongside it.
      if (error instanceof SignInTimeout) setNeedsReload(true);
      const code = (error as { code?: string }).code;
      setError(code === "auth/popup-closed-by-user" ? "Sign-in was closed. Try again when you’re ready." : code === "auth/popup-blocked" ? "Allow the Google sign-in popup for this site, then try again." : code === "auth/unauthorized-domain" ? "Sign-in is not configured for this address. Ask the workspace owner to add this domain in Firebase Authentication." : error instanceof Error ? error.message : "Could not sign in. Please try again.");
    } finally { setBusy(false); }
  }
  return <main className="workspace-gate"><div className="brand"><Workflow size={27} />pathways.</div><div className="eyebrow">TEAM WORKSPACE</div><h1>Bring your next application onboard.</h1><p>Sign in to work on your projects, assign engineers, and track what’s ready to start.</p>{!config && <p className="form-error">Sign-in needs configuration. Set the Firebase web configuration and workspace owner email before inviting your team.</p>}{error && <p className="form-error" role="alert">{error}</p>}<div><Button onClick={() => needsReload ? window.location.reload() : void signIn()} disabled={busy || !config}>{busy ? "Signing in…" : needsReload ? "Reload sign-in" : "Continue with Google"}</Button></div><p className="login-note">Access is limited to accounts added by your workspace owner.</p></main>;
}
