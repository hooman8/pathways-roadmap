import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStore, WorkspaceError, type WorkspaceRepository, type WorkspaceState } from "../lib/workspace-store";
import { createProject, updateTeam, saveProjectTask, selectTaskTeam } from "../lib/projects";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { deleteStep } from "../lib/roadmap";
import type { Identity } from "../lib/shared";

export class MemoryRepository implements WorkspaceRepository {
  state: WorkspaceState | null = null;
  async read() { return structuredClone(this.state); }
  async version() { return structuredClone(this.state); }
  async initialize(state: WorkspaceState) { this.state ??= structuredClone(state); }
  async compareAndSwap(before: WorkspaceState, next: WorkspaceState) {
    if (this.state?.revision !== before.revision) return false;
    this.state = structuredClone(next); return true;
  }
}
const owner: Identity = { userId: "owner", email: "owner@example.com", displayName: "Workspace Owner" };
const editor: Identity = { userId: "engineer", email: "engineer@example.com", displayName: "Engineer" };
const viewer: Identity = { userId: "viewer", email: "viewer@example.com", displayName: "Viewer" };
const status = (code: number) => (error: unknown) => error instanceof WorkspaceError && error.status === code;
const store = () => new WorkspaceStore(new MemoryRepository(), owner.email);

test("only the configured owner can initialize a workspace; email cannot impersonate a bound account", async () => {
  const service = store();
  await assert.rejects(service.get(editor), status(403));
  const snapshot = await service.get(owner);
  assert.equal(snapshot.membership.role, "owner");
  await assert.rejects(service.get({ ...owner, userId: "impostor" }), status(403));
  await assert.rejects(new WorkspaceStore(new MemoryRepository(), undefined).get(owner), status(503));
});

test("viewers cannot write or manage access; nonmembers cannot read", async () => {
  const service = store();
  let snapshot = await service.get(owner);
  await service.saveMembers(owner, snapshot.revision, [...snapshot.members!, { email: viewer.email, role: "viewer", projectIds: null }]);
  snapshot = await service.get(viewer);
  assert.equal(snapshot.members, null);
  await assert.rejects(service.save(viewer, snapshot.revision, snapshot.workspace), status(403));
  await assert.rejects(service.saveMembers(viewer, snapshot.revision, []), status(403));
  await assert.rejects(service.get(editor), status(403));
});

test("project-scoped editors cannot read or overwrite hidden projects", async () => {
  const service = store();
  let snapshot = await service.get(owner);
  const workspace = snapshot.workspace!;
  const hidden = createProject(workspace.projects[0].roadmap, "Restricted application", "Private roadmap");
  workspace.projects.push(hidden);
  workspace.engineers.push({ id: "private-engineer", name: "Hidden Engineer", team: "Security" });
  hidden.engineerIds = ["private-engineer"];
  snapshot = await service.save(owner, snapshot.revision, workspace);
  await service.saveMembers(owner, snapshot.revision, [...snapshot.members!, { email: editor.email, role: "editor", projectIds: [workspace.projects[0].id] }]);
  const scoped = await service.get(editor);
  assert.equal(scoped.workspace!.projects.length, 1);
  assert.equal(scoped.workspace!.engineers.length, 0);
  const attack = structuredClone(scoped.workspace!); attack.projects.push(hidden); attack.engineers.push(workspace.engineers[0]);
  await assert.rejects(service.save(editor, scoped.revision, attack), status(403));
  const edit = structuredClone(scoped.workspace!); edit.projects[0].roadmap.application = "Allowed rename";
  await service.save(editor, scoped.revision, edit);
  const after = await service.get(owner);
  assert.deepEqual(after.workspace!.projects.find(p => p.id === hidden.id), hidden);
  assert.equal(after.workspace!.projects[0].roadmap.application, "Allowed rename");
});

test("simultaneous writes accept one revision and reject the other without losing data", async () => {
  const service = store();
  const snapshot = await service.get(owner);
  const a = structuredClone(snapshot.workspace!), b = structuredClone(snapshot.workspace!);
  a.projects[0].roadmap.application = "First"; b.projects[0].roadmap.application = "Second";
  const results = await Promise.allSettled([service.save(owner, snapshot.revision, a), service.save(owner, snapshot.revision, b)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const failure = results.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(status(409)(failure.reason));
  assert.ok(failure.reason.snapshot);
});

test("revocation wins over an editor holding an older revision", async () => {
  const service = store();
  let snapshot = await service.get(owner);
  await service.saveMembers(owner, snapshot.revision, [...snapshot.members!, { email: editor.email, role: "editor", projectIds: null }]);
  const stale = await service.get(editor);
  snapshot = await service.get(owner);
  await service.saveMembers(owner, snapshot.revision, snapshot.members!.filter(m => m.email !== editor.email));
  await assert.rejects(service.save(editor, stale.revision, stale.workspace), status(403));
  assert.equal(await service.unchanged(editor, (await service.get(owner)).revision), false);
});

test("malformed assignments and access lists are rejected on the server", async () => {
  const service = store();
  const snapshot = await service.get(owner);
  const invalid = structuredClone(snapshot.workspace!);
  invalid.projects[0].roadmap.tasks[0].assigneeIds = ["unknown"];
  await assert.rejects(service.save(owner, snapshot.revision, invalid), status(400));
  await assert.rejects(service.saveMembers(owner, snapshot.revision, []), status(400));
  await assert.rejects(service.saveMembers(owner, snapshot.revision, [...snapshot.members!, ...snapshot.members!]), status(400));
  await assert.rejects(service.saveMembers(owner, snapshot.revision, [...snapshot.members!, { email: editor.email, role: "editor", projectIds: ["unknown"] }]), status(400));
});

test("owners manage shared teams; scoped editors see only permitted members and preserve the full roster", async () => {
  const service = store();
  let snapshot = await service.get(owner);
  let workspace = updateTeam(snapshot.workspace!, { id: "platform", name: "Platform", engineerIds: ["visible", "hidden"] }, [
    { id: "visible", name: "Visible Engineer", team: "" }, { id: "hidden", name: "Private Engineer", team: "" },
  ]);
  workspace = saveProjectTask(workspace, workspace.projects[0].id, { ...selectTaskTeam(workspace.projects[0].roadmap.tasks[0], workspace.teams.find(t => t.id === "platform")), assigneeIds: ["visible"] });
  workspace = updateTeam(workspace, { id: "private-team", name: "Private team", engineerIds: ["hidden"] });
  snapshot = await service.save(owner, snapshot.revision, workspace);
  await service.saveMembers(owner, snapshot.revision, [...snapshot.members!, { email: editor.email, role: "editor", projectIds: [workspace.projects[0].id] }]);
  let scoped = await service.get(editor);
  assert.deepEqual(scoped.workspace!.teams.find(t => t.id === "platform")!.engineerIds, ["visible"]);
  assert.ok(!JSON.stringify(scoped.workspace).includes("hidden"));
  assert.ok(!JSON.stringify(scoped.workspace).includes("private-team"));
  const altered = structuredClone(scoped.workspace!);
  altered.teams.find(t => t.id === "platform")!.name = "Hijacked name";
  await assert.rejects(service.save(editor, scoped.revision, altered), status(403));
  const valid = structuredClone(scoped.workspace!);
  valid.projects[0].roadmap.tasks[0].description = "An allowed task edit";
  scoped = await service.save(editor, scoped.revision, valid);
  const after = await service.get(owner);
  assert.deepEqual(after.workspace!.teams.find(t => t.id === "platform")!.engineerIds, ["visible", "hidden"]);
  const { teams: _teams, ...legacy } = after.workspace!;
  await assert.rejects(service.save(owner, after.revision, legacy), status(400));
});

test("deleting steps respects project permissions and stale revisions", async () => {
  const service = store();
  let snapshot = await service.get(owner);
  const workspace = snapshot.workspace!;
  const hidden = createProject(workspace.projects[0].roadmap, "Hidden", "Private");
  workspace.projects.push(hidden);
  snapshot = await service.save(owner, snapshot.revision, workspace);
  await service.saveMembers(owner, snapshot.revision, [...snapshot.members!, { email: editor.email, role: "editor", projectIds: [workspace.projects[0].id] }, { email: viewer.email, role: "viewer", projectIds: null }]);
  const scoped = await service.get(editor);
  const deletion = structuredClone(scoped.workspace!);
  while (deletion.projects[0].roadmap.tasks.length) deletion.projects[0].roadmap = deleteStep(deletion.projects[0].roadmap.tasks[0].id, deletion.projects[0].roadmap);
  await service.save(editor, scoped.revision, deletion);
  const after = await service.get(owner);
  assert.deepEqual(after.workspace!.projects[0].roadmap.tasks, []);
  assert.deepEqual(after.workspace!.projects[1], hidden);
  const view = await service.get(viewer);
  const forbidden = structuredClone(view.workspace!); forbidden.projects[1].roadmap = deleteStep(hidden.roadmap.tasks[0].id, hidden.roadmap);
  await assert.rejects(service.save(viewer, view.revision, forbidden), status(403));
  await assert.rejects(service.save(editor, scoped.revision, deletion), status(409));
  assert.deepEqual((await service.get(owner)).workspace!.projects[1], hidden);
});
