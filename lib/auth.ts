import { cookies } from "next/headers";
import { firebaseAuth } from "./firebase-admin";
import type { Identity } from "./shared";
export const SESSION_COOKIE = "__session";
export async function getUser(): Promise<Identity | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const claims = await firebaseAuth().verifySessionCookie(cookie, true);
    if (!claims.email || !claims.email_verified) return null;
    return { userId: claims.uid, email: claims.email, displayName: claims.name || claims.email };
  } catch (error) {
    // Token failures are anonymous; configuration/network failures must not be
    // mistaken for revoked sessions.
    const code = (error as { code?: string }).code;
    if (code?.startsWith("auth/") && !["auth/internal-error", "auth/insufficient-permission"].includes(code)) return null;
    throw error;
  }
}
export function assertSameOrigin(request: Request) {
  const configured = process.env.APP_BASE_URL;
  const expected = configured ? new URL(configured).origin : new URL(request.url).origin;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site" || request.headers.get("x-pathways-client") !== "1") throw new Error("This request must come from the workspace.");
}
