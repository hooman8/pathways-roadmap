import test from "node:test";
import assert from "node:assert/strict";
import { migrateRoadmap, createProject } from "../lib/projects";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { mergeWorkspaces, content } from "../lib/shared";
import { changeTaskStatus, resolveImpediments } from "../lib/roadmap";

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
