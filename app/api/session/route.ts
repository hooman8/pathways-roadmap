import { cookies } from "next/headers";
import { assertSameOrigin, SESSION_COOKIE } from "@/lib/auth";
import { firebaseAuth, firestore } from "@/lib/firebase-admin";
import { FirestoreRepository } from "@/lib/firestore-repository";
import { WorkspaceError, WorkspaceStore } from "@/lib/workspace-store";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return Response.json({ error: "Sign in from the workspace." }, { status: 403, headers }); }
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Send JSON." }, { status: 415, headers });
    const text = await request.text();
    if (text.length > 12000) return Response.json({ error: "The sign-in request is too large." }, { status: 413, headers });
    const { idToken } = JSON.parse(text);
    if (typeof idToken !== "string" || idToken.length > 10000) return Response.json({ error: "A sign-in token is required." }, { status: 400, headers });
    const auth = firebaseAuth();
    const claims = await auth.verifyIdToken(idToken, true);
    if (!claims.email || !claims.email_verified || Date.now() / 1000 - claims.auth_time > 300) return Response.json({ error: "Sign in again with a verified Google account." }, { status: 401, headers });
    const user = { userId: claims.uid, email: claims.email, displayName: claims.name || claims.email };
    await new WorkspaceStore(new FirestoreRepository(firestore()), process.env.PATHWAYS_ADMIN_EMAIL).get(user);
    const expiresIn = 5 * 24 * 60 * 60 * 1000;
    const session = await auth.createSessionCookie(idToken, { expiresIn });
    (await cookies()).set(SESSION_COOKIE, session, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: expiresIn / 1000 });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof WorkspaceError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid sign-in request." }, { status: 400, headers });
    const code = (error as { code?: string }).code;
    if (code?.startsWith("auth/") && !["auth/internal-error", "auth/insufficient-permission"].includes(code)) return Response.json({ error: "Your sign-in expired. Please try again." }, { status: 401, headers });
    console.error("Sign-in unavailable", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Sign-in is temporarily unavailable. Please try again shortly." }, { status: 503, headers });
  }
}
export async function DELETE(request: Request) {
  try { assertSameOrigin(request); } catch { return Response.json({ error: "Sign out from the workspace." }, { status: 403, headers }); }
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true }, { headers });
}
