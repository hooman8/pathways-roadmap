import test from "node:test";
import assert from "node:assert/strict";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { progress, changeTaskStatus } from "../lib/roadmap";
import { migrateRoadmap, createProject, updateProject, setProjectTeam, validateWorkspace, exportProject, parseProjectImport, mergeProjectImport, readWorkspace, WORKSPACE_KEY, LEGACY_KEY } from "../lib/projects";

function workspaceWithTeam() {
  const workspace = migrateRoadmap(structuredClone(sampleRoadmap));
  workspace.engineers = [{ id: "alex", name: "Alex Rivera", team: "Platform" }, { id: "sam", name: "Sam Chen", team: "Application" }];
  workspace.projects[0].engineerIds = ["alex", "sam"];
  workspace.projects[0].roadmap.tasks[0].assigneeIds = ["alex", "sam"];
  return validateWorkspace(workspace);
}

test("legacy browser data migrates without losing names, edits, dependencies, or progress", () => {
  const old = structuredClone(sampleRoadmap);
  old.application = "Custom project";
  old.tasks[0].description = "Existing notes";
  const stored = new Map([[LEGACY_KEY, JSON.stringify(old)]]);
  const workspace = readWorkspace({ getItem: key => stored.get(key) ?? null }, sampleRoadmap);
  assert.equal(workspace.projects.length, 1);
  assert.deepEqual(workspace.projects[0].roadmap, old);
  assert.equal(progress(null, workspace.projects[0].roadmap.tasks).done, 3);
  assert.equal(stored.get(LEGACY_KEY), JSON.stringify(old));
});

test("new projects copy hierarchy and dependencies with fresh progress and assignments", () => {
  const workspace = workspaceWithTeam();
  const original = structuredClone(workspace);
  const project = createProject(workspace.projects[0].roadmap, "Customer Portal", "Registry onboarding", ["alex"]);
  assert.equal(project.roadmap.application, "Customer Portal");
  assert.equal(progress(null, project.roadmap.tasks).done, 0);
  assert.ok(project.roadmap.tasks.every(t => t.status === "todo" && !t.assigneeIds?.length));
  const ids = new Set(project.roadmap.tasks.map(t => t.id));
  assert.ok(project.roadmap.tasks.every(t => !workspace.projects[0].roadmap.tasks.some(old => old.id === t.id)));
  assert.ok(project.roadmap.tasks.every(t => (!t.parentId || ids.has(t.parentId)) && t.dependsOn.every(id => ids.has(id))));
  project.roadmap.tasks[0].criteria.push("New project criterion");
  assert.deepEqual(workspace, original);
});

test("editing one project leaves other projects unchanged and active selection survives storage", () => {
  let workspace = workspaceWithTeam();
  const second = createProject(sampleRoadmap, "Second", "Onboarding");
  workspace.projects.push(second);
  workspace.activeProjectId = second.id;
  const firstBefore = structuredClone(workspace.projects[0]);
  const nextRoadmap = structuredClone(second.roadmap);
  nextRoadmap.tasks[0].status = "done";
  workspace = updateProject(workspace, second.id, nextRoadmap);
  assert.deepEqual(workspace.projects[0], firstBefore);
  const restored = readWorkspace({ getItem: key => key === WORKSPACE_KEY ? JSON.stringify(workspace) : null }, sampleRoadmap);
  assert.equal(restored.activeProjectId, second.id);
  assert.equal(progress(null, restored.projects[1].roadmap.tasks).done, 1);
});

test("project rename and team updates retain progress and clear only departing members' assignments", () => {
  const workspace = workspaceWithTeam();
  const original = workspace.projects[0];
  const project = setProjectTeam({ ...original, roadmap: { ...original.roadmap, application: "Renamed project" } }, ["sam"]);
  assert.equal(project.roadmap.application, "Renamed project");
  assert.deepEqual(project.roadmap.tasks[0].assigneeIds, ["sam"]);
  assert.equal(progress(null, project.roadmap.tasks).done, 3);
  assert.deepEqual(original.roadmap.tasks[0].assigneeIds, ["alex", "sam"]);
});

test("workspace validation prevents task assignment outside a project team", () => {
  const workspace = workspaceWithTeam();
  workspace.projects[0].engineerIds = ["alex"];
  assert.throws(() => validateWorkspace(workspace), /must belong/);
  workspace.projects[0].engineerIds = ["missing"];
  assert.throws(() => validateWorkspace(workspace), /roster/);
});

test("project export and import preserve engineers, assignments, progress, and existing projects", () => {
  const workspace = workspaceWithTeam();
  const before = structuredClone(workspace.projects[0]);
  const incoming = parseProjectImport(JSON.parse(JSON.stringify(exportProject(before, workspace.engineers))));
  const merged = mergeProjectImport(workspace, incoming);
  assert.equal(merged.projects.length, 2);
  assert.deepEqual(merged.projects[0], before);
  assert.equal(merged.engineers.length, 2);
  assert.deepEqual(merged.projects[1].roadmap.tasks[0].assigneeIds, ["alex", "sam"]);
  assert.equal(progress(null, merged.projects[1].roadmap.tasks).done, 3);
  assert.equal(merged.activeProjectId, merged.projects[1].id);
});

test("importing a conflicting engineer ID does not reassign an existing person's tasks", () => {
  const workspace = workspaceWithTeam();
  const incoming = parseProjectImport(exportProject(workspace.projects[0], workspace.engineers));
  incoming.engineers[0].name = "Different Alex";
  const merged = mergeProjectImport(workspace, incoming);
  assert.equal(merged.engineers.find(e => e.id === "alex")?.name, "Alex Rivera");
  const newAlex = merged.engineers.find(e => e.name === "Different Alex")!;
  assert.notEqual(newAlex.id, "alex");
  assert.ok(merged.projects[1].roadmap.tasks[0].assigneeIds?.includes(newAlex.id));
  assert.ok(merged.projects[0].roadmap.tasks[0].assigneeIds?.includes("alex"));
});

test("workspace backups roundtrip all projects and corrupt new data does not fall back silently", () => {
  const workspace = workspaceWithTeam();
  workspace.projects.push(createProject(sampleRoadmap, "Another project", "Registry"));
  const incoming = parseProjectImport(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(incoming.projects, workspace.projects);
  assert.deepEqual(incoming.engineers, workspace.engineers);
  assert.throws(() => readWorkspace({ getItem: key => key === WORKSPACE_KEY ? "{broken" : JSON.stringify(sampleRoadmap) }, sampleRoadmap));
});

test("exports retain impediments and not-needed work; new projects start without either", () => {
  const workspace = workspaceWithTeam();
  const roadmap = workspace.projects[0].roadmap;
  roadmap.tasks = changeTaskStatus("identity", "blocked", roadmap.tasks, "Waiting on the platform team");
  roadmap.tasks = changeTaskStatus("retention", "skipped", roadmap.tasks);
  const incoming = parseProjectImport(JSON.parse(JSON.stringify(exportProject(workspace.projects[0], workspace.engineers))));
  const imported = mergeProjectImport(workspace, incoming).projects[1].roadmap;
  assert.equal(imported.tasks.find(t => t.status === "blocked")!.blockedReason, "Waiting on the platform team");
  assert.equal(progress(null, imported.tasks).skipped, 1);
  const freshProject = createProject(roadmap, "Fresh application", "Registry onboarding");
  assert.ok(freshProject.roadmap.tasks.every(t => t.status === "todo" && t.blockedReason === undefined));
});
