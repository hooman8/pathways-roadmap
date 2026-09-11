import test from "node:test";
import assert from "node:assert/strict";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { progress, changeTaskStatus, deleteStep, moveStep } from "../lib/roadmap";
import { migrateRoadmap, createProject, updateProject, setProjectTeam, validateWorkspace, exportProject, parseProjectImport, mergeProjectImport, readWorkspace, WORKSPACE_KEY, LEGACY_KEY, updateTeam, selectTaskTeam, eligibleEngineers, saveProjectTask } from "../lib/projects";

function workspaceWithTeam() {
  const workspace = migrateRoadmap(structuredClone(sampleRoadmap));
  workspace.engineers = [{ id: "alex", name: "Alex Rivera", team: "Platform" }, { id: "sam", name: "Sam Chen", team: "Application" }];
  workspace.projects[0].engineerIds = ["alex", "sam"];
  workspace.projects[0].roadmap.tasks[0].assigneeIds = ["alex", "sam"];
  const team = workspace.teams.find(t => t.id === workspace.projects[0].roadmap.tasks[0].teamId)!;
  team.engineerIds = ["alex", "sam"];
  return validateWorkspace(workspace);
}

test("legacy browser data migrates without losing names, edits, dependencies, or progress", () => {
  const old = structuredClone(sampleRoadmap);
  old.application = "Custom project";
  old.tasks[0].description = "Existing notes";
  const stored = new Map([[LEGACY_KEY, JSON.stringify(old)]]);
  const workspace = readWorkspace({ getItem: key => stored.get(key) ?? null }, sampleRoadmap);
  assert.equal(workspace.projects.length, 1);
  assert.deepEqual({ ...workspace.projects[0].roadmap, tasks: workspace.projects[0].roadmap.tasks.map(({ teamId: _teamId, ...task }) => task) }, old);
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
  const incoming = parseProjectImport(JSON.parse(JSON.stringify(exportProject(before, workspace.engineers, workspace.teams))));
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
  const incoming = parseProjectImport(exportProject(workspace.projects[0], workspace.engineers, workspace.teams));
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
  workspace.projects.push(createProject(workspace.projects[0].roadmap, "Another project", "Registry"));
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
  const incoming = parseProjectImport(JSON.parse(JSON.stringify(exportProject(workspace.projects[0], workspace.engineers, workspace.teams))));
  const imported = mergeProjectImport(workspace, incoming).projects[1].roadmap;
  assert.equal(imported.tasks.find(t => t.status === "blocked")!.blockedReason, "Waiting on the platform team");
  assert.equal(progress(null, imported.tasks).skipped, 1);
  const freshProject = createProject(roadmap, "Fresh application", "Registry onboarding");
  assert.ok(freshProject.roadmap.tasks.every(t => t.status === "todo" && t.blockedReason === undefined));
});

test("legacy team labels migrate deterministically and preserve all existing assignments", () => {
  const roadmap = structuredClone(sampleRoadmap);
  roadmap.tasks[0].owner = "U.S. Innovation";
  roadmap.tasks[0].assigneeIds = ["alex", "sam"];
  const input = { version: 2, activeProjectId: "legacy", engineers: [
    { id: "alex", name: "Alex", team: "" }, { id: "sam", name: "Sam", team: "Platform" },
  ], projects: [{ id: "legacy", engineerIds: ["alex", "sam"], roadmap }] };
  const migrated = validateWorkspace(input);
  const team = migrated.teams.find(t => t.name === "U.S. Innovation")!;
  assert.deepEqual(team.engineerIds, ["alex", "sam"]);
  assert.equal(migrated.projects[0].roadmap.tasks[0].teamId, team.id);
  assert.deepEqual(migrated.projects[0].roadmap.tasks[0].assigneeIds, ["alex", "sam"]);
  assert.deepEqual(migrated, validateWorkspace(input));
  assert.deepEqual(migrated, validateWorkspace(migrated));
  assert.equal(input.projects[0].roadmap.tasks[0].owner, "U.S. Innovation");
});

test("team selection filters engineers, drops only incompatible assignments, and adds new project members on save", () => {
  let workspace = workspaceWithTeam();
  workspace = updateTeam(workspace, { id: "security", name: "Security", engineerIds: ["sam", "lee"] }, [...workspace.engineers, { id: "lee", name: "Lee", team: "" }]);
  const project = workspace.projects[0], team = workspace.teams.find(t => t.id === "security")!;
  const task = selectTaskTeam(project.roadmap.tasks[0], team);
  assert.deepEqual(task.assigneeIds, ["sam"]);
  assert.deepEqual(eligibleEngineers(task, project, workspace).map(e => e.id), ["sam", "lee"]);
  task.assigneeIds = ["sam", "lee"];
  const saved = saveProjectTask(workspace, project.id, task);
  assert.deepEqual(saved.projects[0].engineerIds, ["alex", "sam", "lee"]);
  assert.equal(saved.projects[0].roadmap.tasks[0].owner, "Security");
  assert.equal(saved.projects[0].roadmap.tasks[0].status, project.roadmap.tasks[0].status);
  assert.throws(() => saveProjectTask(workspace, project.id, { ...task, assigneeIds: ["alex"] }), /must belong to “Security”/);
});

test("renaming a team updates every project; removing members clears only that team's assignments", () => {
  const workspace = workspaceWithTeam();
  const originalTeam = workspace.teams.find(t => t.id === workspace.projects[0].roadmap.tasks[0].teamId)!;
  const second = createProject(workspace.projects[0].roadmap, "Second project", "Registry", ["alex", "sam"]);
  second.roadmap.tasks[0].assigneeIds = ["alex"];
  workspace.projects.push(second);
  const changed = updateTeam(workspace, { ...originalTeam, name: "Application Engineering", engineerIds: ["sam"] });
  assert.equal(changed.projects[0].roadmap.tasks[0].owner, "Application Engineering");
  assert.equal(changed.projects[1].roadmap.tasks[0].owner, "Application Engineering");
  assert.deepEqual(changed.projects[0].roadmap.tasks[0].assigneeIds, ["sam"]);
  assert.deepEqual(changed.projects[1].roadmap.tasks[0].assigneeIds, []);
  assert.deepEqual(changed.projects[0].engineerIds, workspace.projects[0].engineerIds);
  assert.equal(progress(null, changed.projects[0].roadmap.tasks).done, 3);
  assert.deepEqual(workspace.projects[0].roadmap.tasks[0].assigneeIds, ["alex", "sam"]);
  assert.throws(() => updateTeam(changed, { id: "duplicate", name: " application engineering ", engineerIds: [] }), /already exists/);
  assert.throws(() => updateTeam(changed, { id: "invalid", name: "Other", engineerIds: ["missing"] }), /roster/);
});

test("project exports exclude unrelated engineers and import never changes an existing team's roster", () => {
  let workspace = workspaceWithTeam();
  const team = workspace.teams.find(t => t.id === workspace.projects[0].roadmap.tasks[0].teamId)!;
  workspace = updateTeam(workspace, { ...team, engineerIds: [...team.engineerIds, "private"] }, [...workspace.engineers, { id: "private", name: "Outside project", team: "" }]);
  const exported = exportProject(workspace.projects[0], workspace.engineers, workspace.teams);
  assert.ok(!JSON.stringify(exported).includes("private"));
  const incoming = parseProjectImport(exported);
  const merged = mergeProjectImport(workspace, incoming);
  assert.deepEqual(merged.teams, workspace.teams);
  incoming.engineers[0].name = "A different person";
  const collision = mergeProjectImport(workspace, incoming);
  assert.deepEqual(collision.teams.find(t => t.id === team.id), workspace.teams.find(t => t.id === team.id));
  const importedTask = collision.projects[1].roadmap.tasks[0];
  assert.notEqual(importedTask.teamId, team.id);
  assert.ok(importedTask.owner.includes("imported"));
});

test("step deletion preserves team directories, project engineers, other projects, and empty project exports", () => {
  const workspace = workspaceWithTeam();
  const other = createProject(workspace.projects[0].roadmap, "Other project", "Onboarding");
  workspace.projects.push(other);
  let roadmap = workspace.projects[0].roadmap;
  while (roadmap.tasks.length) roadmap = deleteStep(roadmap.tasks[0].id, roadmap);
  const after = updateProject(workspace, workspace.projects[0].id, roadmap);
  assert.deepEqual(after.projects[0].roadmap.tasks, []);
  assert.deepEqual(after.projects[0].engineerIds, workspace.projects[0].engineerIds);
  assert.deepEqual(after.teams, workspace.teams);
  assert.deepEqual(after.engineers, workspace.engineers);
  assert.deepEqual(after.projects[1], other);
  assert.deepEqual(parseProjectImport(exportProject(after.projects[0], after.engineers, after.teams)).projects[0], after.projects[0]);
  const added = saveProjectTask(after, after.projects[0].id, { ...workspace.projects[0].roadmap.tasks[0], id: "new-step", status: "todo" });
  assert.equal(added.projects[0].roadmap.tasks.length, 1);
});

test("substep order survives shared validation, project copies, and export/import", () => {
  const workspace = workspaceWithTeam();
  const project = workspace.projects[0];
  const reordered = { ...project.roadmap, tasks: moveStep("runtime-access", "up", project.roadmap.tasks) };
  const saved = updateProject(workspace, project.id, reordered);
  const restored = parseProjectImport(exportProject(saved.projects[0], saved.engineers, saved.teams)).projects[0];
  assert.deepEqual(restored.roadmap.tasks.map(t => t.id), reordered.tasks.map(t => t.id));
  assert.deepEqual(restored.engineerIds, project.engineerIds);
  assert.deepEqual(saved.teams, workspace.teams);
  const copied = createProject(reordered, "Copy", "Registry");
  assert.deepEqual(copied.roadmap.tasks.map(t => t.title), reordered.tasks.map(t => t.title));
});
