import test from "node:test";
import assert from "node:assert/strict";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { validateRoadmap, taskStatus, progress, reconcile, type Task } from "../lib/roadmap";
import { layoutRoadmap } from "../lib/roadmap-layout";
const fresh = () => structuredClone(sampleRoadmap);
const complete = (tasks: Task[], ids: string[]) => tasks.map(t => ids.includes(t.id) ? { ...t, status: "done" as const } : t);

test("sample exposes independent ready work and counts only leaf tasks", () => {
  const data = validateRoadmap(fresh());
  assert.deepEqual(progress(null, data.tasks), { done: 3, total: 13 });
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
