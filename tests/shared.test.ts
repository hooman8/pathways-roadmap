import test from "node:test";
import assert from "node:assert/strict";
import { migrateRoadmap, createProject } from "../lib/projects";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { mergeWorkspaces, content } from "../lib/shared";
import { changeTaskStatus, resolveImpediments, deleteStep, moveStep, childrenOf } from "../lib/roadmap";

test("simultaneous edits to separate tasks and projects are preserved", () => {
  const base = migrateRoadmap(sampleRoadmap);
  const mine = structuredClone(base), shared = structuredClone(base);
  mine.projects[0].roadmap.tasks[0].description = "My instructions";
  shared.projects[0].roadmap.tasks[1].description = "Their instructions";
  shared.projects.push(createProject(base.projects[0].roadmap, "Another application", "Registry onboarding"));
  const result = mergeWorkspaces(base, mine, shared);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.workspace.projects[0].roadmap.tasks[0].description, "My instructions");
  assert.equal(result.workspace.projects[0].roadmap.tasks[1].description, "Their instructions");
  assert.equal(result.workspace.projects.length, 2);
});

test("overlapping fields produce a reviewable conflict; unrelated shared edits survive", () => {
  const base = migrateRoadmap(sampleRoadmap);
  const mine = structuredClone(base), shared = structuredClone(base);
  mine.projects[0].roadmap.tasks[0].description = "My instructions";
  shared.projects[0].roadmap.tasks[0].description = "Their instructions";
  shared.projects[0].roadmap.application = "Updated project";
  const result = mergeWorkspaces(base, mine, shared);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].mine, "My instructions");
  assert.equal(result.conflicts[0].shared, "Their instructions");
  assert.equal(result.workspace.projects[0].roadmap.application, "Updated project");
});

test("replaying a committed save after a lost response is harmless", () => {
  const base = migrateRoadmap(sampleRoadmap), mine = structuredClone(base);
  mine.projects[0].roadmap.application = "Saved project";
  const result = mergeWorkspaces(base, mine, structuredClone(mine));
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(content(result.workspace), content(mine));
});

test("active project choice stays local to each engineer", () => {
  const base = migrateRoadmap(sampleRoadmap);
  base.projects.push(createProject(base.projects[0].roadmap, "Second", "Registry onboarding"));
  const mine = structuredClone(base); mine.activeProjectId = mine.projects[1].id;
  assert.deepEqual(content(base), content(mine));
  const result = mergeWorkspaces(base, mine, base);
  assert.equal(result.workspace.activeProjectId, mine.activeProjectId);
});

test("impediments merge with independent skipped work and concurrent resolution is reviewed", () => {
  const base = migrateRoadmap(sampleRoadmap);
  const mine = structuredClone(base), shared = structuredClone(base);
  mine.projects[0].roadmap.tasks = changeTaskStatus("identity", "blocked", mine.projects[0].roadmap.tasks, "Approval pending");
  shared.projects[0].roadmap.tasks = changeTaskStatus("retention", "skipped", shared.projects[0].roadmap.tasks);
  const merged = mergeWorkspaces(base, mine, shared);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.workspace.projects[0].roadmap.tasks.find(t => t.id === "identity")!.blockedReason, "Approval pending");
  assert.equal(merged.workspace.projects[0].roadmap.tasks.find(t => t.id === "retention")!.status, "skipped");
  const resolved = structuredClone(merged.workspace), updated = structuredClone(merged.workspace);
  resolved.projects[0].roadmap.tasks = resolveImpediments("identity", resolved.projects[0].roadmap.tasks);
  updated.projects[0].roadmap.tasks = changeTaskStatus("identity", "blocked", updated.projects[0].roadmap.tasks, "A different approval is pending");
  assert.ok(mergeWorkspaces(merged.workspace, resolved, updated).conflicts.length > 0);
});

test("team membership changes merge with independent task edits; concurrent roster changes require review", () => {
  const base = migrateRoadmap(sampleRoadmap);
  base.engineers = [{ id: "alex", name: "Alex", team: "" }, { id: "sam", name: "Sam", team: "" }];
  const mine = structuredClone(base), shared = structuredClone(base);
  mine.teams[0].engineerIds = ["alex"];
  shared.projects[0].roadmap.tasks[0].description = "Independent edit";
  const merged = mergeWorkspaces(base, mine, shared);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.workspace.teams[0].engineerIds, ["alex"]);
  shared.teams[0].engineerIds = ["sam"];
  assert.ok(mergeWorkspaces(base, mine, shared).conflicts.length > 0);
});

test("deletion merges with independent edits but conflicts with edits to removed work or new dependency links", () => {
  const base = migrateRoadmap(sampleRoadmap);
  const mine = structuredClone(base), shared = structuredClone(base);
  mine.projects[0].roadmap = deleteStep("network", mine.projects[0].roadmap);
  shared.projects[0].roadmap.tasks.find(t => t.id === "retention")!.description = "Independent change";
  const merged = mergeWorkspaces(base, mine, shared);
  assert.deepEqual(merged.conflicts, []);
  assert.ok(!merged.workspace.projects[0].roadmap.tasks.some(t => t.id === "network"));
  assert.equal(merged.workspace.projects[0].roadmap.tasks.find(t => t.id === "retention")!.description, "Independent change");
  shared.projects[0].roadmap.tasks.find(t => t.id === "runtime-access")!.description = "New work on the removed substep";
  assert.ok(mergeWorkspaces(base, mine, shared).conflicts.length > 0);
  const linked = structuredClone(base);
  linked.projects[0].roadmap.tasks.find(t => t.id === "retention")!.dependsOn.push("runtime-access");
  assert.ok(mergeWorkspaces(base, mine, linked).conflicts.length > 0);
  const newChild = structuredClone(base);
  newChild.projects[0].roadmap.tasks.push({ ...newChild.projects[0].roadmap.tasks.find(t => t.id === "runtime-access")!, id: "new-child" });
  assert.ok(mergeWorkspaces(base, mine, newChild).conflicts.length > 0);
});

test("a substep reorder survives concurrent task edits in either save order", () => {
  const base = migrateRoadmap(sampleRoadmap);
  const mine = structuredClone(base), shared = structuredClone(base);
  mine.projects[0].roadmap.tasks = moveStep("runtime-access", "up", mine.projects[0].roadmap.tasks);
  shared.projects[0].roadmap.tasks.find(t => t.id === "runtime-access")!.description = "New approval instructions";
  for (const [local, remote] of [[mine, shared], [shared, mine]]) {
    const merged = mergeWorkspaces(base, local, remote);
    assert.deepEqual(merged.conflicts, []);
    assert.deepEqual(childrenOf("network", merged.workspace.projects[0].roadmap.tasks).map(t => t.id), ["runtime-access", "runner-access"]);
    assert.equal(merged.workspace.projects[0].roadmap.tasks.find(t => t.id === "runtime-access")!.description, "New approval instructions");
  }
});

test("independent sibling reorders and concurrent insertions or deletions are retained", () => {
  const base = migrateRoadmap(sampleRoadmap);
  const mine = structuredClone(base), shared = structuredClone(base);
  mine.projects[0].roadmap.tasks = moveStep("runtime-access", "up", mine.projects[0].roadmap.tasks);
  shared.projects[0].roadmap.tasks = moveStep("retention", "up", shared.projects[0].roadmap.tasks);
  shared.projects[0].roadmap.tasks.push({ ...shared.projects[0].roadmap.tasks.find(t => t.id === "runner-access")!, id: "new-check", title: "Additional connectivity check" });
  shared.projects[0].roadmap = deleteStep("dockerfile", shared.projects[0].roadmap);
  const merged = mergeWorkspaces(base, mine, shared);
  assert.deepEqual(merged.conflicts, []);
  const tasks = merged.workspace.projects[0].roadmap.tasks;
  assert.deepEqual(childrenOf("network", tasks).map(t => t.id), ["runtime-access", "runner-access", "new-check"]);
  assert.deepEqual(childrenOf("registry", tasks).map(t => t.id), ["repository", "identity", "retention", "permissions"]);
  assert.ok(!tasks.some(t => t.id === "dockerfile"));
});

test("incompatible concurrent sibling moves produce an explicit order conflict", () => {
  const base = migrateRoadmap(sampleRoadmap);
  const mine = structuredClone(base), shared = structuredClone(base);
  mine.projects[0].roadmap.tasks = moveStep("identity", "up", mine.projects[0].roadmap.tasks);
  shared.projects[0].roadmap.tasks = moveStep("permissions", "up", shared.projects[0].roadmap.tasks);
  const merged = mergeWorkspaces(base, mine, shared);
  assert.ok(merged.conflicts.some(c => c.path.endsWith("Registry setup order")));
});
