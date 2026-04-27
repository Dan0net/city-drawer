import type { Graph, GraphEdge, EdgeKind } from './graph';
import type { Building, BuildingType, Obb } from './buildings';
import { BUILDING_TYPES, UNIT, obbOverlap } from './buildings';

const ROAD_HALF_WIDTH: Record<EdgeKind, number> = { road: 3, path: 1 };
const EDGE_CLEARANCE = 0.5; // gap between edge surface and building face
const BUILDING_GAP = 0.6; // breathing room between buildings

export interface SpawnContext {
  graph: Graph;
  buildings: Building[];
}

export type Rng = () => number;

export function pickType(rand: Rng): BuildingType {
  let total = 0;
  for (const t of BUILDING_TYPES) total += t.weight;
  let r = rand() * total;
  for (const t of BUILDING_TYPES) {
    r -= t.weight;
    if (r <= 0) return t.type;
  }
  return BUILDING_TYPES[0].type;
}

// Random edge weighted by length.
export function pickEdge(graph: Graph, rand: Rng): GraphEdge | null {
  let total = 0;
  for (const e of graph.edges.values()) {
    const a = graph.nodes.get(e.from)!;
    const b = graph.nodes.get(e.to)!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (total === 0) return null;
  let r = rand() * total;
  for (const e of graph.edges.values()) {
    const a = graph.nodes.get(e.from)!;
    const b = graph.nodes.get(e.to)!;
    r -= Math.hypot(b.x - a.x, b.y - a.y);
    if (r <= 0) return e;
  }
  return null;
}

// Try one placement attempt: random edge, side, t, type → try sizes largest→smallest.
// Returns the placed building (without its id assigned) or null.
export function trySpawn(
  ctx: SpawnContext,
  simTime: number,
  rand: Rng,
): Omit<Building, 'id'> | null {
  const edge = pickEdge(ctx.graph, rand);
  if (!edge) return null;

  const from = ctx.graph.nodes.get(edge.from)!;
  const to = ctx.graph.nodes.get(edge.to)!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < UNIT) return null;

  const tx = dx / len;
  const ty = dy / len;
  const nx = -ty;
  const ny = tx;
  const side: 1 | -1 = rand() < 0.5 ? 1 : -1;

  // Stay away from junctions
  const t = 0.1 + rand() * 0.8;
  const px = from.x + dx * t;
  const py = from.y + dy * t;

  const halfRoad = ROAD_HALF_WIDTH[edge.kind];
  const baseRot = Math.atan2(dy, dx);
  const jitter = (rand() - 0.5) * (Math.PI / 18); // ±5°
  const rot = baseRot + jitter;

  const typeName = pickType(rand);
  const typeDef = BUILDING_TYPES.find((td) => td.type === typeName)!;

  for (const [uw, uh] of typeDef.sizes) {
    const w = uw * UNIT;
    const h = uh * UNIT;
    const setback = halfRoad + EDGE_CLEARANCE + h / 2;
    const cx = px + side * nx * setback;
    const cy = py + side * ny * setback;
    const candidate: Obb = { cx, cy, w, h, rot };

    if (overlapsAnyBuilding(candidate, ctx.buildings)) continue;
    if (overlapsAnyEdge(ctx.graph, candidate)) continue;

    return {
      type: typeName,
      cx,
      cy,
      w,
      h,
      rot,
      progress: 0,
      spawnedAt: simTime,
    };
  }
  return null;
}

function overlapsAnyBuilding(candidate: Obb, buildings: Building[]): boolean {
  // Inflate candidate by BUILDING_GAP in both dims so neighbors keep breathing room.
  const inflated: Obb = {
    cx: candidate.cx,
    cy: candidate.cy,
    w: candidate.w + BUILDING_GAP,
    h: candidate.h + BUILDING_GAP,
    rot: candidate.rot,
  };
  for (const other of buildings) {
    if (obbOverlap(inflated, other)) return true;
  }
  return false;
}

function overlapsAnyEdge(graph: Graph, candidate: Obb): boolean {
  // Cheap rejection radius from candidate center.
  const rCand = Math.hypot(candidate.w, candidate.h) / 2;
  for (const e of graph.edges.values()) {
    const a = graph.nodes.get(e.from)!;
    const b = graph.nodes.get(e.to)!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) continue;
    const halfW = ROAD_HALF_WIDTH[e.kind] + 0.1;

    // Closest point on segment to candidate center.
    let t = ((candidate.cx - a.x) * dx + (candidate.cy - a.y) * dy) / (len * len);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const sx = a.x + dx * t;
    const sy = a.y + dy * t;
    const ddx = candidate.cx - sx;
    const ddy = candidate.cy - sy;
    if (ddx * ddx + ddy * ddy > (rCand + halfW) * (rCand + halfW)) continue;

    const edgeObb: Obb = {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      w: len,
      h: halfW * 2,
      rot: Math.atan2(dy, dx),
    };
    if (obbOverlap(candidate, edgeObb)) return true;
  }
  return false;
}
