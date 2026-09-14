import test from "node:test";
import assert from "node:assert/strict";
import { layoutRoadmap, type LayoutResult } from "../lib/roadmap-layout";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { validateRoadmap, type Task } from "../lib/roadmap";
import { step } from "./decision-fixture";

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
function crosses(a: Point, b: Point, r: Rect) {
  let from = 0, to = 1;
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? r.width : r.height;
    const low = r[axis] + .01, high = r[axis] + size - .01;
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < .001) { if (a[axis] < low || a[axis] > high) return false; }
    else {
      const p = (low - a[axis]) / delta, q = (high - a[axis]) / delta;
      from = Math.max(from, Math.min(p, q)); to = Math.min(to, Math.max(p, q));
    }
  }
  return from <= to;
}
function checkRoutes(layout: LayoutResult) {
  const absolute = new Map<string, Rect>();
  for (const node of layout.nodes) {
    const parent = node.parentId ? absolute.get(node.parentId)! : { x: 0, y: 0 };
    absolute.set(node.id, { ...node, x: parent.x + node.x, y: parent.y + node.y });
  }
  for (const edge of layout.edges) {
    const source = layout.nodes.find(n => n.id === edge.source)!, target = layout.nodes.find(n => n.id === edge.target)!;
    const s = absolute.get(source.id)!, t = absolute.get(target.id)!;
    const { points } = edge.route;
    const close = (a: Point, b: Point) => Math.abs(a.x - b.x) < .01 && Math.abs(a.y - b.y) < .01;
    assert.ok(close(points[0], { x: s.x + source.outputX, y: s.y + source.height }), `${edge.id} starts at its output handle`);
    assert.ok(close(points[points.length - 1], { x: t.x + target.inputX, y: t.y }), `${edge.id} ends at its input handle`);
    assert.ok(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      assert.ok(Math.abs(a.x - b.x) < .01 || Math.abs(a.y - b.y) < .01, `${edge.id} has a right-angle route`);
      for (const node of layout.nodes) {
        const expanded = layout.nodes.some(n => n.parentId === node.id);
        const rect = absolute.get(node.id)!;
        // Expanded containers may contain connectors, but their title and
        // collapse control must remain clear just like ordinary task cards.
        const obstacle = expanded ? { ...rect, height: 109 } : rect;
        assert.equal(crosses(a, b, obstacle), false, `${edge.id} crosses ${node.id}${expanded ? " header" : " card"}: ${JSON.stringify([a, b, obstacle])}`);
      }
    }
    if (edge.label) {
      assert.ok(edge.route.labelPosition, `${edge.id} has a positioned label`);
      const p = edge.route.labelPosition;
      assert.ok(points.slice(1).some((b, i) => {
        const a = points[i];
        return Math.abs(a.x - b.x) < .01 ? Math.abs(p.x - a.x) < .01 && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
          : Math.abs(p.y - a.y) < .01 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x);
      }), `${edge.id} label stays on its connector`);
      const label = { x: edge.route.labelPosition.x - 22, y: edge.route.labelPosition.y - 12, width: 44, height: 24 };
      for (const node of layout.nodes.filter(n => !layout.nodes.some(child => child.parentId === n.id))) {
        const rect = absolute.get(node.id)!;
        const overlap = label.x < rect.x + rect.width && rect.x < label.x + label.width && label.y < rect.y + rect.height && rect.y < label.y + label.height;
        assert.equal(overlap, false, `${edge.id} label overlaps ${node.id}`);
      }
    }
  }
}

test("rendered connector routes avoid cards and headers in collapsed and expanded workstreams", async () => {
  for (const expanded of [new Set<string>(), new Set(["registry"]), new Set(["registry", "container", "network", "validation"])]) checkRoutes(await layoutRoadmap(sampleRoadmap.tasks, expanded));
});

test("decision bypasses and cross-workstream links go around the pipeline card", async () => {
  const tasks: Task[] = [step("review"), step("setup", { dependsOn: ["review"] }),
    step("decision", { parentId: "setup", decision: { answer: null } }),
    step("optional-work", { parentId: "setup", condition: { decisionId: "decision", answer: "yes" } }),
    step("optional-one", { parentId: "optional-work" }), step("optional-two", { parentId: "optional-work", dependsOn: ["optional-one"] }),
    ...["repository", "environment", "registry", "scan", "access"].map(id => step(id, { parentId: "setup" })),
    step("pipeline", { parentId: "setup", dependsOn: ["repository", "environment", "registry", "scan", "access", "decision", "optional-work"] }),
    step("parallel-work"), step("other-review", { parentId: "parallel-work", dependsOn: ["review"] }),
    step("publish", { dependsOn: ["setup", "parallel-work"] }),
  ];
  const roadmap = validateRoadmap({ ...sampleRoadmap, tasks });
  const original = structuredClone(roadmap);
  for (const expanded of [new Set<string>(), new Set(["setup"]), new Set(["setup", "optional-work", "parallel-work"])]) {
    const layout = await layoutRoadmap(roadmap.tasks, expanded);
    checkRoutes(layout);
    assert.deepEqual(layout.edges.filter(e => e.label === "No").map(e => [e.source, e.target]), expanded.has("setup") ? [["decision", "pipeline"]] : []);
  }
  assert.deepEqual(roadmap, original);
});

test("nested connector coordinates and shared Yes labels remain correct after collapse and re-expansion", async () => {
  const tasks = [step("decision", { decision: { answer: null } }), step("branch", { condition: { decisionId: "decision", answer: "yes" } }),
    step("nested", { parentId: "branch" }), step("one", { parentId: "nested" }), step("two", { parentId: "nested", dependsOn: ["one"] }),
    step("parallel", { parentId: "branch" }), step("join", { dependsOn: ["decision", "branch"] })];
  for (const expanded of [new Set(["branch", "nested"]), new Set(["branch"]), new Set<string>(), new Set(["branch", "nested"])]) {
    const layout = await layoutRoadmap(tasks, expanded);
    checkRoutes(layout);
    assert.equal(layout.edges.filter(e => e.source === "decision" && e.label === "Yes").length, 1);
  }
});
