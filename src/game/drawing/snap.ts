import type { Graph, EdgeId, NodeId, Anchor } from '@game/graph';
import { wrapPi } from '@lib/math';

const SNAP_ANGLE_STEP = Math.PI / 4; // 45°
// Soft band: outside it, the cursor angle passes through unchanged.
const SNAP_ANGLE_TOLERANCE = (5 * Math.PI) / 180;
const SNAP_LENGTH_STEP = 10; // m

export type SnapResult =
  | { kind: 'node'; nodeId: NodeId; x: number; y: number }
  | { kind: 'edge'; edgeId: EdgeId; t: number; x: number; y: number }
  | { kind: 'free'; x: number; y: number };

export const snapToAnchor = (s: SnapResult): Anchor => {
  if (s.kind === 'node') return { kind: 'node', nodeId: s.nodeId };
  if (s.kind === 'edge') return { kind: 'split', edgeId: s.edgeId, t: s.t };
  return { kind: 'free', x: s.x, y: s.y };
};

export const computeSnap = (
  graph: Graph,
  x: number,
  y: number,
  radius: number,
): SnapResult => {
  const node = graph.nearestNode(x, y, radius);
  if (node) return { kind: 'node', nodeId: node.id, x: node.x, y: node.y };
  const edge = graph.nearestEdge(x, y, radius);
  if (edge) return { kind: 'edge', edgeId: edge.edge.id, t: edge.t, x: edge.px, y: edge.py };
  return { kind: 'free', x, y };
};

// From a node: every incident edge direction. From an edge-split: the edge's
// tangent. From a free start: just X. Each yields ±k·45° candidates downstream.
const referenceAngles = (graph: Graph, start: SnapResult): number[] => {
  if (start.kind === 'node') {
    const node = graph.nodes.get(start.nodeId);
    if (!node) return [0];
    const out: number[] = [];
    for (const eid of node.edges) {
      const e = graph.edges.get(eid);
      if (!e) continue;
      const other = graph.nodes.get(e.from === node.id ? e.to : e.from);
      if (!other) continue;
      out.push(Math.atan2(other.y - node.y, other.x - node.x));
    }
    return out.length > 0 ? out : [0];
  }
  if (start.kind === 'edge') {
    const e = graph.edges.get(start.edgeId);
    if (!e) return [0];
    const a = graph.nodes.get(e.from);
    const b = graph.nodes.get(e.to);
    if (!a || !b) return [0];
    return [Math.atan2(b.y - a.y, b.x - a.x)];
  }
  return [0];
};

export const applyDrawSnap = (graph: Graph, start: SnapResult, raw: SnapResult): SnapResult => {
  const dx = raw.x - start.x;
  const dy = raw.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return raw;

  const refs = referenceAngles(graph, start);
  const cur = Math.atan2(dy, dx);
  let bestAngle = cur;
  let bestDelta = Infinity;
  for (const ref of refs) {
    // Round (cur−ref) to nearest k·45°: ±k fan is symmetric, one k per ref.
    const k = Math.round(wrapPi(cur - ref) / SNAP_ANGLE_STEP);
    const candidate = ref + k * SNAP_ANGLE_STEP;
    const delta = Math.abs(wrapPi(candidate - cur));
    if (delta < bestDelta) {
      bestDelta = delta;
      bestAngle = candidate;
    }
  }
  if (bestDelta > SNAP_ANGLE_TOLERANCE) bestAngle = cur;

  const snappedLen = Math.max(
    SNAP_LENGTH_STEP,
    Math.round(len / SNAP_LENGTH_STEP) * SNAP_LENGTH_STEP,
  );
  return {
    kind: 'free',
    x: start.x + Math.cos(bestAngle) * snappedLen,
    y: start.y + Math.sin(bestAngle) * snappedLen,
  };
};
