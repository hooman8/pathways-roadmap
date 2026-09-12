import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { dependencyEdges, childrenOf, type Task } from "./roadmap";

export type PositionedTask = { id: string; parentId?: string; x: number; y: number; width: number; height: number };
export type LayoutResult = { nodes: PositionedTask[]; edges: { id: string; source: string; target: string; label?: string }[] };
let elk: InstanceType<typeof ELK> | undefined;

export async function layoutRoadmap(tasks: Task[], expanded: Set<string>): Promise<LayoutResult> {
  if (!tasks.length) return { nodes: [], edges: [] };
  elk ??= new ELK();
  const visible = new Set<string>();
  function build(parentId: string | null): ElkNode[] {
    return tasks.filter(t => t.parentId === parentId).map(t => {
      visible.add(t.id);
      const kids = childrenOf(t.id, tasks);
      if (kids.length && expanded.has(t.id)) return {
        id: t.id,
        layoutOptions: { "elk.padding": "[top=112,left=24,bottom=24,right=24]", "elk.direction": "DOWN", "elk.spacing.nodeNode": "24", "elk.layered.spacing.nodeNodeBetweenLayers": "40" },
        children: build(t.id),
      };
      return { id: t.id, width: 270, height: kids.length ? 208 : 132 };
    });
  }
  const children = build(null);
  function representative(id: string): string {
    const t = tasks.find(t => t.id === id)!;
    if (visible.has(id)) return id;
    return t.parentId ? representative(t.parentId) : id;
  }
  const edges = [...new Map(dependencyEdges(tasks).map(edge => {
    const source = representative(edge.source), target = representative(edge.target);
    return [`${source}:${target}:${edge.label ?? ""}`, { id: `${source}:${target}:${edge.label ?? ""}`, source, target, ...(edge.label ? { label: edge.label } : {}) }];
  })).values()].filter(edge => edge.source !== edge.target);
  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "42", "elk.layered.spacing.nodeNodeBetweenLayers": "88",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", "elk.padding": "[top=12,left=16,bottom=12,right=16]",
    },
    children,
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  const nodes: PositionedTask[] = [];
  function flatten(node: ElkNode, parentId?: string) {
    if (node.id !== "root") nodes.push({ id: node.id, parentId, x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 270, height: node.height ?? 132 });
    node.children?.forEach(child => flatten(child, node.id === "root" ? undefined : node.id));
  }
  flatten(result);
  return { nodes, edges };
}
