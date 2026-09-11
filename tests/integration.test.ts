import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { FirestoreRepository } from "../lib/firestore-repository";
import { WorkspaceStore, WorkspaceError } from "../lib/workspace-store";
import type { SharedSnapshot } from "../lib/shared";
import { changeTaskStatus, resolveImpediments, taskStatus, deleteStep } from "../lib/roadmap";
import { updateTeam, selectTaskTeam, saveProjectTask } from "../lib/projects";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { same } from "../lib/shared";

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
    let withTeam = updateTeam(latest.workspace!, { id: "delivery", name: "Delivery Engineering", engineerIds: ["engineer-one"] }, [{ id: "engineer-one", name: "Test Engineer", team: "" }]);
    withTeam = saveProjectTask(withTeam, withTeam.projects[0].id, { ...selectTaskTeam(withTeam.projects[0].roadmap.tasks[0], withTeam.teams.find(t => t.id === "delivery")), assigneeIds: ["engineer-one"] });
    const teamSave = await request("/api/workspace", "PUT", { revision: latest.revision, workspace: withTeam }, cookie);
    assert.equal(teamSave.status, 200, await teamSave.text());
    latest = await (await request("/api/workspace", "GET", undefined, cookie)).json() as SharedSnapshot;
    assert.ok(same(latest.workspace, withTeam));
    assert.equal(latest.workspace!.projects[0].roadmap.tasks[0].teamId, "delivery");
    assert.deepEqual(latest.workspace!.projects[0].engineerIds, ["engineer-one"]);
    const statuses = structuredClone(latest.workspace!);
    statuses.projects[0].roadmap.tasks = changeTaskStatus("identity", "blocked", statuses.projects[0].roadmap.tasks, "Waiting on external approval");
    statuses.projects[0].roadmap.tasks = changeTaskStatus("retention", "skipped", statuses.projects[0].roadmap.tasks);
    assert.equal((await request("/api/workspace", "PUT", { revision: latest.revision, workspace: statuses }, cookie)).status, 200);
    latest = await (await request("/api/workspace", "GET", undefined, cookie)).json() as SharedSnapshot;
    const persistedTasks = latest.workspace!.projects[0].roadmap.tasks;
    assert.equal(persistedTasks.find(t => t.id === "identity")!.blockedReason, "Waiting on external approval");
    assert.equal(taskStatus("retention", persistedTasks), "skipped");
    const invalid = structuredClone(latest.workspace!);
    delete invalid.projects[0].roadmap.tasks.find(t => t.id === "identity")!.blockedReason;
    assert.equal((await request("/api/workspace", "PUT", { revision: latest.revision, workspace: invalid }, cookie)).status, 400);
    const resolved = structuredClone(latest.workspace!);
    resolved.projects[0].roadmap.tasks = resolveImpediments("identity", resolved.projects[0].roadmap.tasks);
    assert.equal((await request("/api/workspace", "PUT", { revision: latest.revision, workspace: resolved }, cookie)).status, 200);
    latest = await (await request("/api/workspace", "GET", undefined, cookie)).json() as SharedSnapshot;
    assert.equal(taskStatus("identity", latest.workspace!.projects[0].roadmap.tasks), "ready");
    assert.equal(taskStatus("retention", latest.workspace!.projects[0].roadmap.tasks), "skipped");
    const invalidDeletion = structuredClone(latest.workspace!);
    invalidDeletion.projects[0].roadmap.tasks = invalidDeletion.projects[0].roadmap.tasks.filter(t => t.id !== "runtime-access");
    assert.equal((await request("/api/workspace", "PUT", { revision: latest.revision, workspace: invalidDeletion }, cookie)).status, 400);
    const deletion = structuredClone(latest.workspace!);
    deletion.projects[0].roadmap = deleteStep("network", deletion.projects[0].roadmap);
    const deleted = await request("/api/workspace", "PUT", { revision: latest.revision, workspace: deletion }, cookie);
    assert.equal(deleted.status, 200, await deleted.text());
    latest = await (await request("/api/workspace", "GET", undefined, cookie)).json() as SharedSnapshot;
    assert.ok(same(latest.workspace, deletion));
    const empty = structuredClone(latest.workspace!);
    while (empty.projects[0].roadmap.tasks.length) empty.projects[0].roadmap = deleteStep(empty.projects[0].roadmap.tasks[0].id, empty.projects[0].roadmap);
    const emptied = await request("/api/workspace", "PUT", { revision: latest.revision, workspace: empty }, cookie);
    assert.equal(emptied.status, 200, await emptied.text());
    latest = await (await request("/api/workspace", "GET", undefined, cookie)).json() as SharedSnapshot;
    assert.deepEqual(latest.workspace!.projects[0].roadmap.tasks, []);
    assert.deepEqual(latest.workspace!.engineers, deletion.engineers);
    assert.deepEqual(latest.workspace!.teams, deletion.teams);
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

test("legacy Firestore data upgrades teams and task references together without losing assignments", async () => {
  const id = `migration-${crypto.randomUUID()}`, root = db.collection("workspaces").doc(id);
  const user = { userId: "owner", email: "owner@example.com", displayName: "Owner" };
  const roadmap = structuredClone(sampleRoadmap);
  roadmap.tasks[0].owner = "Application Engineering";
  roadmap.tasks[0].assigneeIds = ["existing-engineer"];
  const project = { id: "original-project", engineerIds: ["existing-engineer"], roadmap };
  const doc = root.collection("projects").doc(Buffer.from(project.id).toString("base64url"));
  try {
    await root.set({ revision: 7, members: [{ ...user, role: "owner", projectIds: null }], updatedAt: new Date().toISOString(), updatedBy: user.displayName,
      projectIds: [project.id], engineers: [{ id: "existing-engineer", name: "Existing Engineer", team: "" }] });
    await doc.set(project);
    const store = new WorkspaceStore(new FirestoreRepository(db, id), user.email);
    const before = await store.get(user);
    const team = before.workspace!.teams.find(t => t.name === "Application Engineering")!;
    assert.deepEqual(team.engineerIds, ["existing-engineer"]);
    assert.deepEqual(before.workspace!.projects[0].roadmap.tasks[0].assigneeIds, ["existing-engineer"]);
    const draft = structuredClone(before.workspace!);
    draft.projects[0].roadmap.title = "First save after upgrade";
    const saved = await store.save(user, before.revision, draft);
    assert.ok((await doc.get()).get("roadmap.tasks").every((t: { teamId?: string | null }) => t.teamId !== undefined));
    const renamed = updateTeam(saved.workspace!, { ...team, name: "Renamed Team" });
    await store.save(user, saved.revision, renamed);
    const fresh = await new WorkspaceStore(new FirestoreRepository(db, id), user.email).get(user);
    assert.ok(same(fresh.workspace, renamed));
    assert.equal(fresh.workspace!.projects[0].roadmap.tasks[0].status, roadmap.tasks[0].status);
  } finally { await db.recursiveDelete(root); }
});
