import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { FirestoreRepository } from "../lib/firestore-repository";
import { WorkspaceStore, WorkspaceError } from "../lib/workspace-store";
import type { SharedSnapshot } from "../lib/shared";

const projectId = process.env.GOOGLE_CLOUD_PROJECT!;
if (!projectId?.startsWith("demo-") || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Integration tests require isolated emulators.");
const app = initializeApp({ projectId });
const db = getFirestore(app), auth = getAuth(app);
const origin = "http://127.0.0.1:5188";
async function account(email: string, verified = true) {
  const uid = email.split("@")[0];
  try { await auth.deleteUser(uid); } catch { /* Test account may not exist. */ }
  const password = `Test-${crypto.randomUUID()}-only`;
  await auth.createUser({ uid, email, emailVerified: verified, password });
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test-only`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body.idToken as string;
}
async function request(path: string, method = "GET", body?: unknown, cookie = "", from = origin) {
  return fetch(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", "X-Pathways-Client": "1", Origin: from, ...(cookie ? { Cookie: cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

test("Firestore commits are durable across repository instances and atomic under concurrent writes", async () => {
  const id = `test-${crypto.randomUUID()}`;
  const user = { userId: "owner", email: "owner@example.com", displayName: "Owner" };
  const a = new WorkspaceStore(new FirestoreRepository(db, id), user.email);
  const b = new WorkspaceStore(new FirestoreRepository(db, id), user.email);
  try {
    const before = await a.get(user);
    const first = structuredClone(before.workspace!), second = structuredClone(before.workspace!);
    first.projects[0].roadmap.application = "Version A"; second.projects[0].roadmap.application = "Version B";
    const results = await Promise.allSettled([a.save(user, before.revision, first), b.save(user, before.revision, second)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const failed = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    assert.ok(failed.reason instanceof WorkspaceError && failed.reason.status === 409);
    const persisted = await new WorkspaceStore(new FirestoreRepository(db, id), user.email).get(user);
    assert.equal(persisted.revision, before.revision + 1);
    assert.match(persisted.workspace!.projects[0].roadmap.application, /^Version [AB]$/);
  } finally { await db.recursiveDelete(db.collection("workspaces").doc(id)); }
});

test("HTTP authentication, CSRF, memberships, revision checks, and sign-out protect shared data", async () => {
  await db.recursiveDelete(db.collection("workspaces").doc("default"));
  try {
    assert.equal((await request("/api/workspace")).status, 401);
    const ownerToken = await account("owner@example.com");
    assert.equal((await request("/api/session", "POST", { idToken: ownerToken }, "", "https://untrusted.example")).status, 403);
    assert.equal((await request("/api/session", "POST", { idToken: "not-a-token" })).status, 401);
    const outsiderToken = await account("outsider@example.com");
    assert.equal((await request("/api/session", "POST", { idToken: outsiderToken })).status, 403);
    const unverified = await account("unverified@example.com", false);
    assert.equal((await request("/api/session", "POST", { idToken: unverified })).status, 401);
    const signIn = await request("/api/session", "POST", { idToken: ownerToken });
    assert.equal(signIn.status, 200, await signIn.text());
    const cookie = signIn.headers.get("set-cookie")!.split(";")[0];
    assert.match(signIn.headers.get("set-cookie")!, /httponly/i);
    const initial = await (await request("/api/workspace", "GET", undefined, cookie)).json() as SharedSnapshot;
    assert.equal(initial.membership.role, "owner");
    assert.equal((await request(`/api/workspace?revision=${initial.revision}`, "GET", undefined, cookie)).status, 304);
    const draft = structuredClone(initial.workspace!); draft.projects[0].roadmap.application = "HTTP saved project";
    assert.equal((await request("/api/workspace", "PUT", { revision: initial.revision, workspace: draft }, cookie, "https://untrusted.example")).status, 403);
    const saved = await request("/api/workspace", "PUT", { revision: initial.revision, workspace: draft }, cookie);
    assert.equal(saved.status, 200, await saved.text());
    assert.equal((await request("/api/workspace", "PUT", { revision: initial.revision, workspace: initial.workspace }, cookie)).status, 409);
    let latest = await (await request("/api/workspace", "GET", undefined, cookie)).json() as SharedSnapshot;
    assert.equal(latest.workspace!.projects[0].roadmap.application, "HTTP saved project");
    const members = [...latest.members!, { email: "viewer@example.com", role: "viewer", projectIds: null }];
    assert.equal((await request("/api/members", "PUT", { revision: latest.revision, members }, cookie)).status, 200);
    const viewerToken = await account("viewer@example.com");
    const viewerLogin = await request("/api/session", "POST", { idToken: viewerToken });
    assert.equal(viewerLogin.status, 200, await viewerLogin.text());
    const viewerCookie = viewerLogin.headers.get("set-cookie")!.split(";")[0];
    const view = await (await request("/api/workspace", "GET", undefined, viewerCookie)).json() as SharedSnapshot;
    assert.equal(view.members, null);
    assert.equal((await request("/api/workspace", "PUT", { revision: view.revision, workspace: view.workspace }, viewerCookie)).status, 403);
    latest = await (await request("/api/workspace", "GET", undefined, cookie)).json() as SharedSnapshot;
    assert.equal((await request("/api/members", "PUT", { revision: latest.revision, members: latest.members!.filter(m => m.email !== "viewer@example.com") }, cookie)).status, 200);
    assert.equal((await request("/api/workspace", "GET", undefined, viewerCookie)).status, 403);
    const signOut = await request("/api/session", "DELETE", undefined, cookie);
    assert.equal(signOut.status, 200); assert.match(signOut.headers.get("set-cookie")!, /expires=Thu, 01 Jan 1970/i);
    assert.equal((await request("/api/workspace")).status, 401);
  } finally { await db.recursiveDelete(db.collection("workspaces").doc("default")); }
});
