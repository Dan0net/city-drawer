import type { Graph, EdgeId } from '@game/graph';
import type { SnapResult } from '@game/drawing/snap';

interface DrawingCrossing {
  x: number;
  y: number;
  t: number; // along start → end
  edgeId: EdgeId;
  s: number; // along the existing edge
}

// Edges crossed by the straight segment start→end, sorted by distance from
// start. Skips edges sharing an endpoint with the start/end snap (incidence,
// not a crossing) and the start/end split edges themselves.
export const findRoadCrossings = (
  graph: Graph,
  start: SnapResult,
  end: SnapResult,
): DrawingCrossing[] => {
  const ax = start.x;
  const ay = start.y;
  const ex = end.x - ax;
  const ey = end.y - ay;
  if (ex * ex + ey * ey < 1e-6) return [];

  const startNode = start.kind === 'node' ? start.nodeId : null;
  const endNode = end.kind === 'node' ? end.nodeId : null;
  const startEdge = start.kind === 'edge' ? start.edgeId : null;
  const endEdge = end.kind === 'edge' ? end.edgeId : null;
  const EPS = 1e-4;

  const out: DrawingCrossing[] = [];
  for (const e of graph.edges.values()) {
    if (e.id === startEdge || e.id === endEdge) continue;
    if (startNode != null && (e.from === startNode || e.to === startNode)) continue;
    if (endNode != null && (e.from === endNode || e.to === endNode)) continue;
    const a = graph.nodes.get(e.from)!;
    const b = graph.nodes.get(e.to)!;
    const fx = b.x - a.x;
    const fy = b.y - a.y;
    const denom = ex * fy - ey * fx;
    if (Math.abs(denom) < 1e-9) continue;
    const inv = 1 / denom;
    const t = ((a.x - ax) * fy - (a.y - ay) * fx) * inv;
    const s = ((a.x - ax) * ey - (a.y - ay) * ex) * inv;
    if (t < EPS || t > 1 - EPS) continue;
    if (s < EPS || s > 1 - EPS) continue;
    out.push({ x: ax + ex * t, y: ay + ey * t, t, edgeId: e.id, s });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
};
