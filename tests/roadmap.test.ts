import test from "node:test";
import assert from "node:assert/strict";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { validateRoadmap, taskStatus, progress, progressPercent, progressText, reconcile, changeTaskStatus, resolveImpediments, blockedBy, type Task } from "../lib/roadmap";
import { layoutRoadmap } from "../lib/roadmap-layout";
const fresh = () => structuredClone(sampleRoadmap);
const complete = (tasks: Task[], ids: string[]) => tasks.map(t => ids.includes(t.id) ? { ...t, status: "done" as const } : t);

test("sample exposes independent ready work and counts only leaf tasks", () => {
  const data = validateRoadmap(fresh());
  assert.deepEqual(progress(null, data.tasks), { done: 3, total: 13, skipped: 0 });
  for (const id of ["retention", "build", "runner-access", "runtime-access"]) assert.equal(taskStatus(id, data.tasks), "ready");
  assert.equal(taskStatus("permissions", data.tasks), "blocked");
});

test("specific substeps unlock CI without waiting for their entire groups", () => {
  const tasks = complete(fresh().tasks, ["identity", "permissions", "build", "runner-access"]);
  assert.equal(taskStatus("pipeline", tasks), "ready");
  assert.notEqual(taskStatus("registry", tasks), "done");
  assert.notEqual(taskStatus("network", tasks), "done");
  assert.equal(taskStatus("complete", tasks), "blocked");
});

test("reopening an inherited prerequisite resets all downstream progress", () => {
  let tasks = fresh().tasks.map(t => ({ ...t, status: "done" as Task["status"] }));
  tasks = reconcile(tasks.map(t => t.id === "intake" ? { ...t, status: "todo" } : t));
  assert.equal(progress(null, tasks).done, 0);
  assert.equal(taskStatus("intake", tasks), "ready");
  for (const id of ["repository", "dockerfile", "pipeline", "complete"]) assert.equal(taskStatus(id, tasks), "blocked");
});

test("rollup waits for every required substep", () => {
  let tasks = complete(fresh().tasks, ["identity", "permissions"]);
  assert.equal(progress("registry", tasks).done, 3);
  assert.equal(taskStatus("registry", tasks), "ready");
  tasks = complete(tasks, ["retention"]);
  assert.equal(taskStatus("registry", tasks), "done");
});

test("not-needed prerequisites unlock work without inflating completed progress", () => {
  let tasks = changeTaskStatus("identity", "skipped", fresh().tasks);
  assert.equal(taskStatus("identity", tasks), "skipped");
  assert.equal(taskStatus("permissions", tasks), "ready");
  assert.deepEqual(progress(null, tasks), { done: 3, total: 12, skipped: 1 });
  tasks = changeTaskStatus("permissions", "done", tasks);
  tasks = changeTaskStatus("identity", "todo", tasks);
  assert.equal(taskStatus("permissions", tasks), "blocked");
  assert.equal(tasks.find(t => t.id === "permissions")!.status, "todo");
});

test("skipped substeps survive reopened prerequisites and still appear in dependency structure", () => {
  let tasks = changeTaskStatus("identity", "skipped", fresh().tasks);
  tasks = changeTaskStatus("intake", "todo", tasks);
  assert.equal(taskStatus("identity", tasks), "skipped");
  assert.equal(taskStatus("permissions", tasks), "blocked");
  assert.deepEqual(blockedBy("permissions", tasks).map(t => t.id), ["intake"]);
});

test("workstream rollups exclude skipped leaves and handle all-not-needed progress", () => {
  let tasks = changeTaskStatus("registry", "skipped", fresh().tasks);
  assert.equal(taskStatus("registry", tasks), "skipped");
  assert.deepEqual(progress("registry", tasks), { done: 0, total: 0, skipped: 4 });
  assert.equal(progressPercent(progress("registry", tasks)), 0);
  assert.equal(progressText(progress("registry", tasks)), "4 not needed");
  tasks = changeTaskStatus("repository", "todo", tasks);
  tasks = changeTaskStatus("repository", "done", tasks);
  assert.equal(taskStatus("registry", tasks), "done");
  assert.deepEqual(progress("registry", tasks), { done: 1, total: 1, skipped: 3 });
  tasks = fresh().tasks.map(t => ({ ...t, status: "todo" as const }));
  for (const root of tasks.filter(t => !t.parentId)) tasks = changeTaskStatus(root.id, "skipped", tasks);
  assert.deepEqual(progress(null, tasks), { done: 0, total: 0, skipped: 13 });
});

test("impediments need reasons, hold up downstream work, and remain until explicitly resolved", () => {
  assert.throws(() => changeTaskStatus("identity", "blocked", fresh().tasks, "   "), /Describe the impediment/);
  let tasks = changeTaskStatus("identity", "blocked", fresh().tasks, " Waiting for account provisioning ");
  assert.equal(tasks.find(t => t.id === "identity")!.blockedReason, "Waiting for account provisioning");
  assert.equal(taskStatus("identity", tasks), "blocked");
  assert.equal(taskStatus("permissions", tasks), "blocked");
  assert.throws(() => changeTaskStatus("identity", "done", tasks), /Resolve the impediment/);
  tasks = changeTaskStatus("intake", "todo", tasks);
  assert.equal(tasks.find(t => t.id === "identity")!.status, "blocked");
  tasks = resolveImpediments("identity", tasks);
  assert.equal(tasks.find(t => t.id === "identity")!.blockedReason, undefined);
  assert.equal(taskStatus("identity", tasks), "blocked", "unfinished prerequisites still apply");
  tasks = changeTaskStatus("intake", "done", tasks);
  assert.equal(taskStatus("identity", tasks), "blocked", "the reopened repository still needs completing");
  tasks = changeTaskStatus("repository", "done", tasks);
  assert.equal(taskStatus("identity", tasks), "ready");
});

test("bulk impediments preserve completed, skipped, and separately blocked substeps", () => {
  let tasks = changeTaskStatus("identity", "blocked", fresh().tasks, "Existing obstacle");
  tasks = changeTaskStatus("retention", "skipped", tasks);
  tasks = changeTaskStatus("registry", "blocked", tasks, "Platform outage");
  assert.equal(tasks.find(t => t.id === "repository")!.status, "done");
  assert.equal(tasks.find(t => t.id === "retention")!.status, "skipped");
  assert.equal(tasks.find(t => t.id === "identity")!.blockedReason, "Existing obstacle");
  assert.equal(tasks.find(t => t.id === "permissions")!.blockedReason, "Platform outage");
  assert.equal(taskStatus("registry", tasks), "blocked");
  tasks = resolveImpediments("registry", tasks);
  assert.equal(tasks.find(t => t.id === "retention")!.status, "skipped");
  assert.equal(taskStatus("identity", tasks), "ready");
  assert.equal(taskStatus("permissions", tasks), "blocked");
});

test("validation preserves impediments and skipped work, but rejects missing reasons and dependency loops", () => {
  const data = fresh();
  data.tasks = changeTaskStatus("identity", "blocked", data.tasks, "External approval needed");
  data.tasks = changeTaskStatus("retention", "skipped", data.tasks);
  assert.deepEqual(validateRoadmap(JSON.parse(JSON.stringify(data))), data);
  delete data.tasks.find(t => t.id === "identity")!.blockedReason;
  assert.throws(() => validateRoadmap(data), /Add a reason/);
  data.tasks = changeTaskStatus("identity", "skipped", data.tasks);
  data.tasks.find(t => t.id === "identity")!.dependsOn = ["permissions"];
  assert.throws(() => validateRoadmap(data), /loop/);
});

test("imports reject duplicate IDs, missing references, hierarchy loops, and dependency cycles", () => {
  let data = fresh(); data.tasks.push({ ...data.tasks[0] }); assert.throws(() => validateRoadmap(data), /unique/);
  data = fresh(); data.tasks[0].dependsOn = ["missing"]; assert.throws(() => validateRoadmap(data), /does not exist/);
  data = fresh(); data.tasks.find(t => t.id === "registry")!.parentId = "identity"; assert.throws(() => validateRoadmap(data), /contain itself/);
  data = fresh(); data.tasks[0].dependsOn = ["complete"]; assert.throws(() => validateRoadmap(data), /loop/);
  data = fresh(); data.tasks.find(t => t.id === "registry")!.dependsOn = ["permissions"]; assert.throws(() => validateRoadmap(data), /loop/);
});

test("collapsed and expanded layouts have finite, nonoverlapping sibling bounds", async () => {
  for (const expanded of [new Set<string>(), new Set(["registry"]), new Set(["registry", "container", "network", "validation"])]) {
    const layout = await layoutRoadmap(fresh().tasks, expanded);
    assert.ok(layout.nodes.length >= 5);
    for (const n of layout.nodes) {
      assert.ok([n.x, n.y, n.width, n.height].every(Number.isFinite));
      if (n.parentId) {
        const parent = layout.nodes.find(p => p.id === n.parentId)!;
        assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width <= parent.width + 1 && n.y + n.height <= parent.height + 1);
      }
      for (const other of layout.nodes.filter(o => o.id !== n.id && o.parentId === n.parentId)) {
        const overlaps = n.x < other.x + other.width && other.x < n.x + n.width && n.y < other.y + other.height && other.y < n.y + n.height;
        assert.equal(overlaps, false, `${n.id} overlaps ${other.id}`);
      }
    }
    assert.ok(layout.edges.every(e => layout.nodes.some(n => n.id === e.source) && layout.nodes.some(n => n.id === e.target)));
  }
});
