import test from "node:test";
import assert from "node:assert/strict";
import { answerDecision, branchState, changeTaskStatus, deleteStep, dependencyEdges, planStepDeletion, progress, taskStatus, validateRoadmap, type Task } from "../lib/roadmap";
import { layoutRoadmap } from "../lib/roadmap-layout";
import { createProject, exportProject, mergeProjectImport, migrateRoadmap, parseProjectImport } from "../lib/projects";
import { mergeWorkspaces } from "../lib/shared";
import { decisionRoadmap, step } from "./decision-fixture";

const status = (tasks: Task[], id: string) => taskStatus(id, tasks);
const readyDecision = () => changeTaskStatus("review", "done", decisionRoadmap().tasks);

test("decisions wait for review, gate inherited branches, and require an actual answer", () => {
  let tasks = validateRoadmap(decisionRoadmap()).tasks;
  assert.equal(status(tasks, "database-needed"), "blocked");
  assert.equal(status(tasks, "database"), "waiting");
  assert.equal(status(tasks, "configure-db"), "waiting");
  assert.throws(() => answerDecision("database-needed", "yes", tasks), /prerequisites/);
  assert.throws(() => changeTaskStatus("database-needed", "done", tasks), /answer controls/);
  assert.throws(() => changeTaskStatus("create-db", "done", tasks), /controlling decision/);
  tasks = readyDecision();
  assert.equal(status(tasks, "database-needed"), "ready");
  tasks = answerDecision("database-needed", "yes", tasks);
  assert.equal(status(tasks, "database-needed"), "done");
  assert.equal(status(tasks, "create-db"), "ready");
  assert.equal(status(tasks, "configure-db"), "blocked");
  assert.equal(status(tasks, "continue"), "blocked");
  tasks = changeTaskStatus("create-db", "done", tasks);
  tasks = changeTaskStatus("configure-db", "done", tasks);
  assert.equal(status(tasks, "continue"), "ready");
});

test("No bypasses database work without counting it complete; Yes restores its requirements", () => {
  let tasks = answerDecision("database-needed", "no", readyDecision());
  assert.equal(status(tasks, "database"), "skipped");
  assert.equal(status(tasks, "configure-db"), "skipped");
  assert.equal(status(tasks, "continue"), "ready");
  assert.deepEqual(progress(null, tasks), { done: 2, total: 3, skipped: 2 });
  tasks = changeTaskStatus("continue", "done", tasks);
  tasks = answerDecision("database-needed", "yes", tasks);
  assert.equal(status(tasks, "create-db"), "ready");
  assert.equal(status(tasks, "continue"), "blocked");
  assert.equal(tasks.find(t => t.id === "continue")!.status, "todo");
  assert.deepEqual(progress(null, tasks), { done: 2, total: 5, skipped: 0 });
});

test("answer changes preserve branch progress and impediments, and clearing waits again", () => {
  let tasks = answerDecision("database-needed", "yes", readyDecision());
  tasks = changeTaskStatus("create-db", "done", tasks);
  tasks = changeTaskStatus("configure-db", "blocked", tasks, "Approval from operations");
  tasks = answerDecision("database-needed", "no", tasks);
  assert.equal(status(tasks, "configure-db"), "skipped");
  tasks = answerDecision("database-needed", "yes", tasks);
  assert.equal(status(tasks, "create-db"), "done");
  assert.equal(status(tasks, "configure-db"), "blocked");
  assert.equal(tasks.find(t => t.id === "configure-db")!.blockedReason, "Approval from operations");
  tasks = answerDecision("database-needed", null, tasks);
  assert.equal(status(tasks, "create-db"), "waiting");
  assert.equal(status(tasks, "continue"), "blocked");
  assert.equal(progress(null, tasks).done, 1);
});

test("reopening review clears the answer and rechecks downstream work", () => {
  let tasks = answerDecision("database-needed", "yes", readyDecision());
  tasks = changeTaskStatus("create-db", "done", tasks);
  tasks = changeTaskStatus("review", "todo", tasks);
  assert.equal(tasks.find(t => t.id === "database-needed")!.decision!.answer, null);
  assert.equal(status(tasks, "create-db"), "waiting");
  assert.equal(status(tasks, "continue"), "blocked");
  assert.deepEqual(validateRoadmap({ ...decisionRoadmap(), tasks }).tasks, tasks);
});

test("nested decisions exclude their whole branch and explicit No branches work", () => {
  let tasks = readyDecision();
  tasks.push(step("hosting-choice", { decision: { answer: null }, condition: { decisionId: "database-needed", answer: "yes" } }),
    step("managed-db", { condition: { decisionId: "hosting-choice", answer: "yes" } }),
    step("self-hosted", { condition: { decisionId: "hosting-choice", answer: "no" } }),
    step("no-db-check", { condition: { decisionId: "database-needed", answer: "no" } }));
  tasks = validateRoadmap({ ...decisionRoadmap(), tasks }).tasks;
  tasks = answerDecision("database-needed", "no", tasks);
  for (const id of ["hosting-choice", "managed-db", "self-hosted"]) assert.equal(status(tasks, id), "skipped");
  assert.equal(status(tasks, "no-db-check"), "ready");
  tasks = answerDecision("database-needed", "yes", tasks);
  assert.equal(status(tasks, "hosting-choice"), "ready");
  assert.equal(status(tasks, "managed-db"), "waiting");
  tasks = answerDecision("hosting-choice", "no", tasks);
  assert.equal(status(tasks, "managed-db"), "skipped");
  assert.equal(status(tasks, "self-hosted"), "ready");
  assert.equal(status(tasks, "no-db-check"), "skipped");
});

test("invalid decision references, groups, contradictions, and dependency loops are rejected", () => {
  const check = (extra: Task[], pattern: RegExp) => assert.throws(() => validateRoadmap({ ...decisionRoadmap(), tasks: [...decisionRoadmap().tasks, ...extra] }), pattern);
  check([step("bad", { condition: { decisionId: "missing", answer: "yes" } })], /existing decision/);
  check([step("bad", { condition: { decisionId: "review", answer: "yes" } })], /existing decision/);
  check([step("bad", { parentId: "database-needed" })], /cannot contain/);
  check([step("bad", { parentId: "database", condition: { decisionId: "database-needed", answer: "no" } })], /both Yes and No/);
  const cyclic = decisionRoadmap(); cyclic.tasks[1].dependsOn = ["database"];
  assert.throws(() => validateRoadmap(cyclic), /loop/);
  const self = decisionRoadmap(); self.tasks[1].condition = { decisionId: "database-needed", answer: "yes" };
  assert.throws(() => validateRoadmap(self), /loop/);
});

test("deleting a decision discloses and removes conditions without deleting branch work", () => {
  const roadmap = { ...decisionRoadmap(), tasks: answerDecision("database-needed", "no", readyDecision()) };
  assert.deepEqual(planStepDeletion("database-needed", roadmap.tasks).conditionalChanges.map(t => t.id), ["database"]);
  const next = deleteStep("database-needed", roadmap);
  assert.ok(next.tasks.some(t => t.id === "create-db"));
  assert.ok(next.tasks.every(t => !t.condition));
  assert.equal(status(next.tasks, "create-db"), "ready");
  assert.equal(status(next.tasks, "continue"), "blocked");
  const emptyBranch = deleteStep("configure-db", deleteStep("create-db", roadmap));
  assert.equal(status(emptyBranch.tasks, "database"), "skipped");
  const activated = answerDecision("database-needed", "yes", emptyBranch.tasks);
  assert.equal(status(activated, "database"), "ready");
});

test("decision answers and branch links roundtrip exports; project copies reset answers", () => {
  const workspace = migrateRoadmap({ ...decisionRoadmap(), tasks: answerDecision("database-needed", "no", readyDecision()) });
  const project = workspace.projects[0];
  const copy = createProject(project.roadmap, "Another app", "Onboarding");
  const copiedDecision = copy.roadmap.tasks.find(t => t.decision)!;
  assert.equal(copiedDecision.decision!.answer, null);
  assert.notEqual(copiedDecision.id, "database-needed");
  assert.equal(copy.roadmap.tasks.find(t => t.condition)!.condition!.decisionId, copiedDecision.id);
  const imported = mergeProjectImport(workspace, parseProjectImport(exportProject(project, workspace.engineers, workspace.teams))).projects[1];
  const importedDecision = imported.roadmap.tasks.find(t => t.decision)!;
  assert.equal(importedDecision.decision!.answer, "no");
  assert.equal(imported.roadmap.tasks.find(t => t.condition)!.condition!.decisionId, importedDecision.id);
  assert.equal(branchState(imported.roadmap.tasks.find(t => t.title === "configure-db")!.id, imported.roadmap.tasks), "inactive");
});

test("different answers conflict while answer plus independent instructions merge", () => {
  const base = migrateRoadmap({ ...decisionRoadmap(), tasks: readyDecision() });
  const mine = structuredClone(base), shared = structuredClone(base);
  mine.projects[0].roadmap.tasks = answerDecision("database-needed", "yes", mine.projects[0].roadmap.tasks);
  shared.projects[0].roadmap.tasks[0].description = "A separate edit";
  const merged = mergeWorkspaces(base, mine, shared);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.workspace.projects[0].roadmap.tasks[1].decision!.answer, "yes");
  shared.projects[0].roadmap.tasks = answerDecision("database-needed", "no", shared.projects[0].roadmap.tasks);
  assert.ok(mergeWorkspaces(base, mine, shared).conflicts.length);
});

test("collapsed and expanded maps retain Yes/No labels and branch positions", async () => {
  const tasks = [...decisionRoadmap().tasks, step("alternative", { condition: { decisionId: "database-needed", answer: "no" } })];
  const collapsed = await layoutRoadmap(tasks, new Set());
  assert.ok(collapsed.edges.some(e => e.source === "database-needed" && e.target === "database" && e.label === "Yes"));
  assert.ok(collapsed.edges.some(e => e.source === "database-needed" && e.target === "alternative" && e.label === "No"));
  assert.ok(collapsed.edges.some(e => e.source === "database-needed" && e.target === "continue" && e.label === "No"));
  const expanded = await layoutRoadmap(tasks, new Set(["database"]));
  assert.deepEqual(expanded.edges.filter(e => e.source === "database-needed" && e.label === "Yes").map(e => e.target), ["database"]);
  assert.ok(expanded.edges.some(e => e.source === "create-db" && e.target === "configure-db" && !e.label));
  assert.ok(expanded.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test("inherited decision labels appear once per workstream through nested expansion", async () => {
  const tasks = [
    step("decision", { decision: { answer: null } }),
    step("yes-work", { condition: { decisionId: "decision", answer: "yes" } }),
    step("nested", { parentId: "yes-work" }),
    step("first", { parentId: "nested" }),
    step("second", { parentId: "nested", condition: { decisionId: "decision", answer: "yes" } }),
    step("parallel", { parentId: "yes-work" }),
    step("separate-yes", { condition: { decisionId: "decision", answer: "yes" } }),
    step("no-work", { condition: { decisionId: "decision", answer: "no" } }),
    step("alternative", { parentId: "no-work" }),
  ];
  const before = structuredClone(tasks);
  const collapsed = await layoutRoadmap(tasks, new Set());
  const expanded = await layoutRoadmap(tasks, new Set(["yes-work", "nested", "no-work"]));
  assert.deepEqual(expanded.edges.map(({ route: _route, ...edge }) => edge), collapsed.edges.map(({ route: _route, ...edge }) => edge));
  assert.deepEqual(expanded.edges.map(e => [e.target, e.label]), [["yes-work", "Yes"], ["separate-yes", "Yes"], ["no-work", "No"]]);
  assert.deepEqual(tasks, before);
  for (const id of ["first", "second", "parallel", "alternative"]) assert.equal(taskStatus(id, tasks), "waiting");
  const answered = answerDecision("decision", "yes", tasks);
  assert.equal(taskStatus("first", answered), "ready");
  assert.equal(taskStatus("alternative", answered), "skipped");
});

test("adding the decision prerequisite moves the bypass to the pipeline join", async () => {
  const tasks = [step("onboarding"), step("approvals", { parentId: "onboarding" }),
    step("decision", { parentId: "approvals", decision: { answer: null } }),
    step("optional", { parentId: "onboarding", condition: { decisionId: "decision", answer: "yes" } }),
    step("repository", { parentId: "onboarding" }),
    step("pipeline", { parentId: "onboarding", dependsOn: ["repository", "optional"] }),
    step("publish", { dependsOn: ["onboarding"] }),
    step("release", { dependsOn: ["onboarding", "publish"] })];
  assert.ok(dependencyEdges(tasks).some(e => e.source === "decision" && e.target === "publish" && e.label === "No"));
  tasks.find(t => t.id === "pipeline")!.dependsOn.push("decision");
  const original = structuredClone(tasks);
  assert.deepEqual(dependencyEdges(tasks).filter(e => e.label === "No"), [{ source: "decision", target: "pipeline", label: "No" }]);
  assert.ok(dependencyEdges(tasks).some(e => e.source === "pipeline" && e.target === "publish"));
  for (const expanded of [new Set<string>(), new Set(["onboarding"]), new Set(["onboarding", "approvals"])]) {
    const layout = await layoutRoadmap(tasks, expanded);
    assert.deepEqual(layout.edges.filter(e => e.label === "No").map(e => [e.source, e.target]),
      expanded.has("onboarding") ? [[expanded.has("approvals") ? "decision" : "approvals", "pipeline"]] : []);
  }
  assert.deepEqual(tasks, original);
  let answered = answerDecision("decision", "no", tasks);
  assert.equal(taskStatus("optional", answered), "skipped");
  assert.equal(taskStatus("pipeline", answered), "blocked");
  answered = changeTaskStatus("repository", "done", answered);
  assert.equal(taskStatus("pipeline", answered), "ready");
  assert.equal(taskStatus("publish", answered), "blocked");
  answered = changeTaskStatus("pipeline", "done", answered);
  assert.equal(taskStatus("publish", answered), "ready");
  answered = answerDecision("decision", "yes", answered);
  assert.equal(taskStatus("pipeline", answered), "blocked");
  assert.equal(taskStatus("publish", answered), "blocked");
});

test("independent joins keep their bypasses for either answer without repeating at later joins", () => {
  for (const answer of ["yes", "no"] as const) {
    const tasks = [step("decision", { decision: { answer: null } }),
      step("optional", { condition: { decisionId: "decision", answer } }),
      step("first", { dependsOn: ["decision", "optional"] }),
      step("parallel", { dependsOn: ["decision", "optional"] }),
      step("middle", { dependsOn: ["first", "parallel"] }),
      step("last", { dependsOn: ["decision", "optional", "middle"] })];
    const edges = dependencyEdges(tasks);
    assert.deepEqual(edges.filter(e => e.source === "decision" && e.label === (answer === "yes" ? "No" : "Yes")).map(e => e.target), ["first", "parallel"]);
    assert.ok(edges.some(e => e.source === "middle" && e.target === "last"));
  }
});

test("a join behind a separate condition does not hide a required downstream bypass", () => {
  const tasks = [step("decision", { decision: { answer: null } }), step("other-decision", { decision: { answer: null } }),
    step("optional", { condition: { decisionId: "decision", answer: "yes" } }),
    step("conditional-join", { dependsOn: ["decision", "optional"], condition: { decisionId: "other-decision", answer: "yes" } }),
    step("continue", { dependsOn: ["decision", "optional", "conditional-join"] })];
  assert.ok(dependencyEdges(tasks).some(e => e.source === "decision" && e.target === "continue" && e.label === "No"));
});
