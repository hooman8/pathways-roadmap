import ELK, { type ElkNode, type ElkExtendedEdge, type ElkPoint } from "elkjs/lib/elk.bundled.js";
import { answerLabel, dependencyEdges, childrenOf, type Task } from "./roadmap";
import { clearConnector, connectorLabel } from "./connector-routing";

export type PositionedTask = { id: string; parentId?: string; x: number; y: number; width: number; height: number; inputX: number; outputX: number };
type VisibleEdge = { id: string; source: string; target: string; label?: string };
export type EdgeRoute = { points: ElkPoint[]; labelPosition?: ElkPoint };
export type LayoutResult = { nodes: PositionedTask[]; edges: (VisibleEdge & { route: EdgeRoute })[] };

function edgeRoute(edge: ElkExtendedEdge, offset: ElkPoint, start: ElkPoint): EdgeRoute {
  const sections = (edge.sections ?? []).map(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(p => ({ x: p.x + offset.x, y: p.y + offset.y })));
  const points: ElkPoint[] = [];
  const samePoint = (a: ElkPoint, b: ElkPoint) => Math.abs(a.x - b.x) < .01 && Math.abs(a.y - b.y) < .01;
  let cursor = start;
  while (sections.length) {
    const index = sections.findIndex(section => samePoint(section[0], cursor));
    if (index < 0) throw new Error("The connector route is incomplete.");
    const section = sections.splice(index, 1)[0];
    points.push(...(points.length ? section.slice(1) : section));
    cursor = section[section.length - 1];
  }
  if (points.length < 2) throw new Error("The connector route is missing.");
  const label = edge.labels?.[0];
  return { points, ...(label?.x !== undefined && label.y !== undefined ? { labelPosition: { x: offset.x + label.x + (label.width ?? 0) / 2, y: offset.y + label.y + (label.height ?? 0) / 2 } } : {}) };
}
let elk: InstanceType<typeof ELK> | undefined;

export async function layoutRoadmap(tasks: Task[], expanded: Set<string>): Promise<LayoutResult> {
  if (!tasks.length) return { nodes: [], edges: [] };
  elk ??= new ELK();
  const visible = new Set<string>();
  const internalIds = new Set(tasks.map(t => t.id));
  function internalId(name: string) {
    let id = name;
    while (internalIds.has(id)) id += "_";
    internalIds.add(id);
    return id;
  }
  const rootId = internalId("__pathways_layout_root__");
  const ports = new Map(tasks.map(t => [t.id, { input: internalId(`${t.id}:input`), output: internalId(`${t.id}:output`) }]));
  const portOptions = { "elk.portConstraints": "FIXED_SIDE", "elk.portAlignment.default": "CENTER" };
  function nodePorts(id: string) {
    return [{ id: ports.get(id)!.input, layoutOptions: { "elk.port.side": "NORTH" } }, { id: ports.get(id)!.output, layoutOptions: { "elk.port.side": "SOUTH" } }];
  }
  function build(parentId: string | null): ElkNode[] {
    return tasks.filter(t => t.parentId === parentId).map(t => {
      visible.add(t.id);
      const kids = childrenOf(t.id, tasks);
      if (kids.length && expanded.has(t.id)) return {
        id: t.id, ports: nodePorts(t.id),
        layoutOptions: { ...portOptions, "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.edgeRouting": "ORTHOGONAL", "elk.padding": "[top=112,left=24,bottom=24,right=24]", "elk.direction": "DOWN", "elk.spacing.nodeNode": "24", "elk.layered.spacing.nodeNodeBetweenLayers": "40" },
        children: build(t.id),
      };
      return { id: t.id, width: 270, height: kids.length ? 208 : 132, ports: nodePorts(t.id), layoutOptions: portOptions };
    });
  }
  const children = build(null);
  function representative(id: string): string {
    const t = tasks.find(t => t.id === id)!;
    if (visible.has(id)) return id;
    return t.parentId ? representative(t.parentId) : id;
  }
  const dependencies = dependencyEdges(tasks);
  function visibleEdges(): VisibleEdge[] {
    return [...new Map(dependencies.map(edge => {
      let targetId = edge.target;
      if (edge.label) {
        // Draw an inherited condition once at the workstream that owns it.
        // Dependency evaluation still operates on the original leaf tasks.
        let task = tasks.find(t => t.id === edge.target);
        while (task) {
          if (task.condition?.decisionId === edge.source && answerLabel(task.condition.answer) === edge.label) targetId = task.id;
          task = tasks.find(t => t.id === task?.parentId);
        }
      }
      const source = representative(edge.source), target = representative(targetId);
      const id = `${source}:${target}:${edge.label ?? ""}`;
      return [id, { id, source, target, ...(edge.label ? { label: edge.label } : {}) }];
    })).values()].filter(edge => edge.source !== edge.target);
  }
  const edges = visibleEdges();
  const result = await elk.layout({
    id: rootId,
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "42", "elk.layered.spacing.nodeNodeBetweenLayers": "88",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", "elk.padding": "[top=12,left=16,bottom=12,right=16]",
    },
    children,
    edges: edges.map(e => ({ id: e.id, sources: [ports.get(e.source)!.output], targets: [ports.get(e.target)!.input], ...(e.label ? { labels: [{ text: e.label, width: 44, height: 24, layoutOptions: { "elk.edgeLabels.placement": "CENTER", "elk.edgeLabels.inline": "true" } }] } : {}) })),
  });
  const nodes: PositionedTask[] = [];
  const absolute = new Map<string, ElkPoint>();
  const routes = new Map<string, ElkExtendedEdge>();
  function flatten(node: ElkNode, parentId?: string, origin: ElkPoint = { x: 0, y: 0 }) {
    const position = { x: origin.x + (node.x ?? 0), y: origin.y + (node.y ?? 0) };
    absolute.set(node.id, position);
    if (node.id !== rootId) nodes.push({ id: node.id, parentId, x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 270, height: node.height ?? 132,
      inputX: node.ports?.find(p => p.id === ports.get(node.id)!.input)?.x ?? (node.width ?? 270) / 2,
      outputX: node.ports?.find(p => p.id === ports.get(node.id)!.output)?.x ?? (node.width ?? 270) / 2 });
    node.edges?.forEach(edge => routes.set(edge.id, { ...edge, container: edge.container ?? node.id }));
    node.children?.forEach(child => flatten(child, node.id === rootId ? undefined : node.id, position));
  }
  flatten(result);
  const obstacles = nodes.map(node => ({ ...absolute.get(node.id)!, width: node.width, height: nodes.some(n => n.parentId === node.id) ? 109 : node.height }));
  return { nodes, edges: edges.map(edge => {
    const source = nodes.find(n => n.id === edge.source)!;
    const sourcePosition = absolute.get(source.id)!;
    const routed = routes.get(edge.id);
    if (!routed) throw new Error("The connector route is missing.");
    const route = edgeRoute(routed, absolute.get(routed.container ?? rootId)!, { x: sourcePosition.x + source.outputX, y: sourcePosition.y + source.height });
    const points = clearConnector(route.points, obstacles);
    return { ...edge, route: { points, ...(route.labelPosition ? { labelPosition: connectorLabel(points, route.labelPosition, obstacles) } : {}) } };
  }) };

}
