export type Point = { x: number; y: number };
export type Obstacle = Point & { width: number; height: number };

export function segmentCrossesCard(a: Point, b: Point, rect: Obstacle) {
  let from = 0, to = 1;
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? rect.width : rect.height;
    const low = rect[axis] + .01, high = rect[axis] + size - .01;
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < .001) { if (a[axis] < low || a[axis] > high) return false; }
    else {
      const p = (low - a[axis]) / delta, q = (high - a[axis]) / delta;
      from = Math.max(from, Math.min(p, q)); to = Math.min(to, Math.max(p, q));
    }
  }
  return from <= to;
}

// ELK can leave straight bridges between hierarchical containers. Keep its
// routed segments and replace those bridges with clear orthogonal detours.
export function clearConnector(points: Point[], obstacles: Obstacle[]): Point[] {
  const clear = (path: Point[]) => path.slice(1).every((point, index) => !obstacles.some(rect => segmentCrossesCard(path[index], point, rect)));
  const distance = (path: Point[]) => path.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0);
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if ((Math.abs(a.x - b.x) < .01 || Math.abs(a.y - b.y) < .01) && clear([a, b])) { result.push(b); continue; }
    const candidates: Point[][] = [[a, { x: b.x, y: a.y }, b], [a, { x: a.x, y: b.y }, b]];
    for (const rect of obstacles) {
      for (const x of [rect.x - 8, rect.x + rect.width + 8]) candidates.push([a, { x, y: a.y }, { x, y: b.y }, b]);
      for (const y of [rect.y - 8, rect.y + rect.height + 8]) candidates.push([a, { x: a.x, y }, { x: b.x, y }, b]);
    }
    const route = candidates.filter(clear).sort((first, second) => distance(first) - distance(second) || first.length - second.length)[0];
    if (!route) throw new Error("A connector could not be drawn clear of the cards.");
    result.push(...route.slice(1));
  }
  return result.filter((point, index) => !index || point.x !== result[index - 1].x || point.y !== result[index - 1].y);
}

export function connectorLabel(points: Point[], preferred: Point, obstacles: Obstacle[]): Point {
  const candidates: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    candidates.push({ x: Math.max(Math.min(a.x, b.x), Math.min(preferred.x, Math.max(a.x, b.x))), y: Math.max(Math.min(a.y, b.y), Math.min(preferred.y, Math.max(a.y, b.y))) });
    for (const fraction of [.5, .25, .75]) candidates.push({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
  }
  const available = candidates.filter(p => !obstacles.some(r => p.x - 22 < r.x + r.width && p.x + 22 > r.x && p.y - 12 < r.y + r.height && p.y + 12 > r.y));
  available.sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y) - Math.hypot(b.x - preferred.x, b.y - preferred.y));
  if (!available.length) throw new Error("A decision label could not be placed clear of the cards.");
  return available[0];
}
