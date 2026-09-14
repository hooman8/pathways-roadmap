"use client";

import { useEffect, useMemo, useState } from "react";
import { BaseEdge, ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Handle, MarkerType, Position, useReactFlow, type Node, type NodeProps, type EdgeProps, type Edge } from "@xyflow/react";
import { ArrowDownRight, Check, ChevronDown, ChevronUp, Circle, Clock3, GitBranch, Hourglass, Layers3, LockKeyhole, SkipForward } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { layoutRoadmap, type LayoutResult, type EdgeRoute } from "@/lib/roadmap-layout";
import { stepStatusLabel, childrenOf, leafTasks, progress, progressPercent, progressText, relatedTasks, taskStatus, type Task, type Status } from "@/lib/roadmap";
import "@xyflow/react/dist/style.css";
import { assignedEngineers, type Engineer } from "@/lib/projects";

type CardData = {
  inputX: number; outputX: number; task: Task; statusLabel: string; assigneeLabel: string; fullAssigneeLabel: string; status: Status; group: boolean; expanded: boolean; done: number; total: number; skipped: number;
  focused: boolean; faded: boolean; blocked: number; onExpand: (id: string) => void; onOpen: (id: string) => void;
};
type TaskNode = Node<CardData, "task">;
const icons = { done: Check, "in-progress": Clock3, blocked: LockKeyhole, ready: Circle, skipped: SkipForward, waiting: Hourglass };

export function StatusMark({ status }: { status: Status }) {
  const Icon = icons[status];
  return <span className={`status-mark ${status}`} aria-hidden="true"><Icon size={13} strokeWidth={2.3} /></span>;
}
function TaskCard({ data }: NodeProps<TaskNode>) {
  return <div className={`task-card ${data.status} ${data.task.decision ? "decision-card" : ""} ${data.group ? "task-group" : ""} ${data.expanded ? "expanded-group" : ""} ${data.focused ? "task-focused" : ""} ${data.faded ? "task-faded" : ""}`}>
    <Handle type="target" style={{ left: data.inputX }} position={Position.Top} isConnectable={false} />
    <div className="task-card-content">
      <div className="task-eyebrow"><span>{data.task.decision ? <><GitBranch size={13} /> DECISION</> : data.group ? "WORKSTREAM" : "TASK"}</span><StatusMark status={data.status} /></div>
      <button className="task-title nodrag" onClick={() => data.onOpen(data.task.id)}>{data.task.title}</button>
      <div className="task-owner" aria-label={data.fullAssigneeLabel}>{data.assigneeLabel}</div>
      {!data.expanded && !data.group && <span className={`task-state ${data.status}`} title={data.task.blockedReason}>{data.task.status === "blocked" && data.status === "blocked" ? "Blocked · impediment" : data.statusLabel}</span>}
      {data.group && !data.expanded && <div className="group-progress"><span>{progressText(data)}</span>{data.blocked > 0 && <span className="blocked-count">{data.blocked} blocked</span>}<Progress value={progressPercent(data)} aria-label={`${data.task.title}: ${progressText(data)}`} /></div>}
    </div>
    {data.group && <button className={`expand-button nodrag ${data.expanded ? "expanded-toggle" : ""}`} onClick={event => { event.stopPropagation(); data.onExpand(data.task.id); }} aria-expanded={data.expanded}>
      <Layers3 size={14} /><span>{data.expanded ? "Collapse substeps" : `Explore ${data.total + data.skipped} substeps`}</span>{data.expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
    </button>}
    <Handle type="source" style={{ left: data.outputX }} position={Position.Bottom} isConnectable={false} />
  </div>;
}
const nodeTypes = { task: TaskCard };
type RoutedEdge = Edge<{ route: EdgeRoute }, "routed">;
function Connector({ data, id, markerEnd, style, label, labelStyle, labelBgStyle, labelBgPadding, interactionWidth }: EdgeProps<RoutedEdge>) {
  if (!data?.route.points.length) return null;
  const path = data.route.points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeLinejoin: "round" }} label={label} labelX={data.route.labelPosition?.x} labelY={data.route.labelPosition?.y} labelStyle={labelStyle} labelBgStyle={labelBgStyle} labelBgPadding={labelBgPadding} interactionWidth={interactionWidth} />;
}
const edgeTypes = { routed: Connector };

function Canvas({ tasks, engineers, expanded, selected, readyOnly, onExpand, onOpen, clearSelection }: {
  tasks: Task[]; engineers: Engineer[]; expanded: Set<string>; selected: string | null; readyOnly: boolean;
  onExpand: (id: string) => void; onOpen: (id: string) => void; clearSelection: () => void;
}) {
  const [layout, setLayout] = useState<LayoutResult>({ nodes: [], edges: [] });
  const [error, setError] = useState(false);
  const [layingOut, setLayingOut] = useState(true);
  const [retry, setRetry] = useState(0);
  const { fitView } = useReactFlow();
  const structure = JSON.stringify(tasks.map(({ id, parentId, dependsOn, condition }) => ({ id, parentId, dependsOn, condition })));
  const expandKey = [...expanded].sort().join("|");
  useEffect(() => {
    let current = true;
    setLayingOut(true); setError(false);
    layoutRoadmap(tasks, expanded).then(result => { if (current) { setLayout(result); setLayingOut(false); } }).catch(() => { if (current) { setError(true); setLayingOut(false); } });
    return () => { current = false; };
    // Status changes do not move tasks; only structural changes trigger a layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, expandKey, retry]);
  useEffect(() => {
    if (!layout.nodes.length) return;
    const timer = setTimeout(() => void fitView({ padding: 0.08, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350, maxZoom: 1 }), 80);
    return () => clearTimeout(timer);
  }, [layout, fitView]);
  const relations = useMemo(() => selected ? relatedTasks(selected, tasks) : null, [selected, tasks]);
  const { nodes, edges } = useMemo(() => {
    const relevant = new Set(relations ? [...relations.selected, ...relations.upstream, ...relations.downstream] : []);
    const active = (id: string) => leafTasks(id, tasks).some(t => relevant.has(t.id));
    const nodes: TaskNode[] = layout.nodes.filter(n => tasks.some(t => t.id === n.id)).map(n => {
      const task = tasks.find(t => t.id === n.id)!;
      const group = childrenOf(n.id, tasks).length > 0;
      const p = progress(n.id, tasks);
      const status = taskStatus(n.id, tasks);
      const assigned = assignedEngineers(task, engineers);
      const assigneeLabel = assigned.length ? `${assigned[0].name}${assigned.length > 1 ? ` +${assigned.length - 1}` : ""}` : task.owner || "Unassigned";
      return {
        id: n.id, type: "task", parentId: n.parentId, position: { x: n.x, y: n.y },
        style: { width: n.width, height: n.height }, draggable: false,
        data: { inputX: n.inputX, outputX: n.outputX, task, statusLabel: stepStatusLabel(task, tasks), assigneeLabel, fullAssigneeLabel: assigned.length ? `Assigned engineers: ${assigned.map(e => e.name).join(", ")}` : `Responsible team: ${task.owner || "Unassigned"}`, status, group, expanded: expanded.has(n.id) && group, ...p,
          focused: selected === n.id, faded: (relations !== null && !active(n.id)) || (readyOnly && !leafTasks(n.id, tasks).some(t => taskStatus(t.id, tasks) === "ready")),
          blocked: leafTasks(n.id, tasks).filter(t => taskStatus(t.id, tasks) === "blocked").length,
          onExpand, onOpen,
        },
      };
    });
    const edges: RoutedEdge[] = layout.edges.filter(e => nodes.some(n => n.id === e.source) && nodes.some(n => n.id === e.target)).map(e => {
      const relevantEdge = !relations || (active(e.source) && active(e.target));
      return { id: e.id, source: e.source, target: e.target, label: e.label, data: { route: e.route }, labelStyle: { fontWeight: 700, fill: "#5e4d99" }, labelBgStyle: { fill: "#f7f3ff" }, labelBgPadding: [8, 4], type: "routed", markerEnd: { type: MarkerType.ArrowClosed, color: relevantEdge ? "#3472d3" : "#c6ceda", width: 15, height: 15 }, style: { stroke: relevantEdge ? "#3472d3" : "#c6ceda", strokeWidth: 2, opacity: relevantEdge ? 1 : 0.28 }, zIndex: 2 };
    });
    return { nodes, edges };
  }, [tasks, engineers, layout, expanded, selected, readyOnly, relations, onExpand, onOpen]);
  return <div className="map-canvas" aria-label="Interactive onboarding dependency map">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesConnectable={false} nodesDraggable={false} elementsSelectable={false}
      minZoom={0.2} maxZoom={1.5} fitView onNodeClick={(_, node) => onOpen(node.id)} onPaneClick={clearSelection}
      defaultEdgeOptions={{ type: "routed" }} colorMode="light">
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d9dfe4" />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
    <div className="canvas-caption"><ArrowDownRight size={16} /><span>Follow the arrows. Branches can run in parallel.</span></div>
    {selected && <Button variant="outline" size="sm" className="clear-focus" onClick={clearSelection}>Clear dependency focus</Button>}
    {layingOut && !layout.nodes.length && <div className="canvas-message" role="status">Arranging your roadmap…</div>}
    {error && <div className="canvas-message" role="alert"><p>The map could not be arranged. Your tasks are still available in the checklist.</p><Button variant="outline" onClick={() => setRetry(v => v + 1)}>Try again</Button></div>}
    <div className="map-legend" aria-label="Task statuses"><span><StatusMark status="done" />Complete</span><span><StatusMark status="in-progress" />In progress</span><span><StatusMark status="ready" />Ready</span><span><StatusMark status="blocked" />Blocked</span><span><StatusMark status="skipped" />Not needed</span><span><StatusMark status="waiting" />Waiting for decision</span></div>
  </div>;
}
export default function RoadmapCanvas(props: Parameters<typeof Canvas>[0]) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
