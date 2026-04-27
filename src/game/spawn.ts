import type { Graph, GraphEdge } from './graph';
import type { Building, BuildingType, FailedAttempt } from './buildings';
import {
  BUILDING_TYPES,
  aabbContainsPoint,
  pointInPoly,
  polyAabb,
  polyArea,
  polyCentroid,
} from './buildings';
import { ROAD_HALF_WIDTH, EDGE_CLEARANCE, type Side } from './roadGeometry';
const SLICE_STEP = 1;
const MIN_DEPTH = 4;
const MAX_DEPTH = 50;
const MIN_AREA_RATIO = 0.5;
// The slice origin must sit strictly OUTSIDE the anchor road's clearance OBB,
// otherwise rayHitOBB's "origin inside OBB" check returns t=0 for the boundary
// and every depth sample comes back as zero. 1 cm is enough to clear FP wobble
// without affecting the building's visual placement.
const RAY_ORIGIN_EPSILON = 0.01;
// Same anchor, smaller targetArea on retry — accepts a smaller building rather than rejecting.
const SHRINK_FACTORS = [1, 0.6];
// Leftover frontage smaller than this gets absorbed into the building rather
// than left as an unusable sliver.
const SLIVER_GAP = 5;

// Placeholder polygon for failures that didn't reach polygon construction.
const PLACEHOLDER_W = 5;
const PLACEHOLDER_H = 6;

export interface SpawnContext {
  graph: Graph;
  buildings: Building[];
}

export type Rng = () => number;

export interface ConsumedFrontage {
  edgeId: number;
  side: Side;
  t0: number;
  t1: number;
}

export type SpawnResult =
  | {
      kind: 'success';
      building: Omit<Building, 'id'>;
      consumed: ConsumedFrontage;
    }
  | { kind: 'failure'; failure: Omit<FailedAttempt, 'id'> };

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

export interface FrontagePick {
  edge: GraphEdge;
  side: Side;
  t0: number;
  t1: number;
}

// Picks an (edge, side, interval) weighted by the world-length of free
// frontage. Edges with no remaining frontage on either side are skipped.
export function pickFrontage(graph: Graph, rand: Rng): FrontagePick | null {
  let total = 0;
  for (const e of graph.edges.values()) {
    const front = graph.frontages.get(e.id);
    if (!front) continue;
    const a = graph.nodes.get(e.from)!;
    const b = graph.nodes.get(e.to)!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    for (const iv of front.left) total += (iv.t1 - iv.t0) * len;
    for (const iv of front.right) total += (iv.t1 - iv.t0) * len;
  }
  if (total <= 0) return null;
  let r = rand() * total;
  for (const e of graph.edges.values()) {
    const front = graph.frontages.get(e.id);
    if (!front) continue;
    const a = graph.nodes.get(e.from)!;
    const b = graph.nodes.get(e.to)!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    for (const iv of front.left) {
      r -= (iv.t1 - iv.t0) * len;
      if (r <= 0) return { edge: e, side: 'left', t0: iv.t0, t1: iv.t1 };
    }
    for (const iv of front.right) {
      r -= (iv.t1 - iv.t0) * len;
      if (r <= 0) return { edge: e, side: 'right', t0: iv.t0, t1: iv.t1 };
    }
  }
  return null;
}

// Choose front-edge width W and start offset within an interval of world
// length L, so leftover on each side is either 0 or > SLIVER_GAP. Returns
// null when L can't host even the smallest front (frontMin).
function pickFrontLayout(
  L: number,
  frontMin: number,
  frontMax: number,
  rand: Rng,
): { width: number; start: number } | null {
  if (L < frontMin) return null;
  // Whole interval fits within frontMax + sliver tolerance: take all of it
  // (W may slightly exceed frontMax; that's the absorption rule).
  if (L < frontMax + SLIVER_GAP) {
    return { width: L, start: 0 };
  }
  // L ≥ frontMax + SLIVER_GAP — must leave real frontage somewhere.
  const flushMaxW = Math.min(frontMax, L - SLIVER_GAP);
  const midMaxW = Math.min(frontMax, L - 2 * SLIVER_GAP);
  const opts: ('low' | 'high' | 'mid')[] = ['low', 'high'];
  if (midMaxW >= frontMin) opts.push('mid');
  const opt = opts[Math.floor(rand() * opts.length)];
  if (opt === 'mid') {
    const W = frontMin + rand() * (midMaxW - frontMin);
    const start = SLIVER_GAP + rand() * (L - W - 2 * SLIVER_GAP);
    return { width: W, start };
  }
  const W = frontMin + rand() * (flushMaxW - frontMin);
  return { width: W, start: opt === 'low' ? 0 : L - W };
}

// ---------- entry point ----------

export function trySpawn(
  ctx: SpawnContext,
  simTime: number,
  rand: Rng,
): SpawnResult | null {
  const pick = pickFrontage(ctx.graph, rand);
  if (!pick) {
    console.log('[spawn] fail: no_frontage');
    return null;
  }
  const { edge, side: pickSide, t0: ivT0, t1: ivT1 } = pick;

  const from = ctx.graph.nodes.get(edge.from)!;
  const to = ctx.graph.nodes.get(edge.to)!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const span = ivT1 - ivT0;
  const intervalWorld = span * len;
  if (intervalWorld < 12) {
    console.log('[spawn] fail: interval_too_short', {
      intervalWorld,
      edgeId: edge.id,
    });
    return null;
  }

  const tx = dx / len;
  const ty = dy / len;
  const sideSign: 1 | -1 = pickSide === 'left' ? 1 : -1;
  const nx = -ty * sideSign;
  const ny = tx * sideSign;

  const halfRoad = ROAD_HALF_WIDTH[edge.kind];
  const clearance = halfRoad + EDGE_CLEARANCE;

  const typeName = pickType(rand);
  const typeDef = BUILDING_TYPES.find((td) => td.type === typeName)!;
  const [frontMin, frontMax] = typeDef.frontRange;

  // Wise front-edge selection: choose width and start offset within the
  // interval so any leftover is either zero or > SLIVER_GAP.
  const layout = pickFrontLayout(intervalWorld, frontMin, frontMax, rand);
  const fallbackT = ivT0 + 0.5 * span;
  const fallbackX = from.x + dx * fallbackT;
  const fallbackY = from.y + dy * fallbackT;
  if (!layout) {
    console.log('[spawn] fail: frontage_too_short', {
      edgeId: edge.id,
      type: typeName,
      available: intervalWorld,
      frontMin,
    });
    return {
      kind: 'failure',
      failure: makePlaceholder(
        fallbackX, fallbackY, tx, ty, nx, ny, clearance, simTime, 'frontage_too_short',
      ),
    };
  }

  const W = layout.width;
  const t = ivT0 + (layout.start + W / 2) / len;
  const anchorX = from.x + dx * t;
  const anchorY = from.y + dy * t;
  const xCapNeg = -W / 2;
  const xCapPos = W / 2;

  const fail = (reason: string, details?: Record<string, unknown>): SpawnResult => {
    console.log(`[spawn] fail: ${reason}`, {
      edgeId: edge.id,
      type: typeName,
      anchor: { x: anchorX, y: anchorY },
      ...details,
    });
    return {
      kind: 'failure',
      failure: makePlaceholder(anchorX, anchorY, tx, ty, nx, ny, clearance, simTime, reason),
    };
  };

  const xs: number[] = [];
  const depths: number[] = [];
  const rayOffset = clearance + RAY_ORIGIN_EPSILON;
  // Evenly distribute slices so xs[0] === xCapNeg and xs[last] === xCapPos
  // exactly. A fixed integer step would leave the high end short by the
  // fractional part of W and produce sub-meter slivers between buildings.
  const numSteps = Math.max(1, Math.round((xCapPos - xCapNeg) / SLICE_STEP));
  const step = (xCapPos - xCapNeg) / numSteps;
  for (let i = 0; i <= numSteps; i++) {
    const x = xCapNeg + i * step;
    xs.push(x);
    const ox = anchorX + tx * x + nx * rayOffset;
    const oy = anchorY + ty * x + ny * rayOffset;
    depths.push(freeDepthAt(ctx, ox, oy, nx, ny, MAX_DEPTH));
  }
  if (xs.length === 0) return fail('no_slices', { xCapNeg, xCapPos });

  let centerIdx = 0;
  let bestAbs = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const a = Math.abs(xs[i]);
    if (a < bestAbs) {
      bestAbs = a;
      centerIdx = i;
    }
  }
  if (depths[centerIdx] < MIN_DEPTH) {
    return fail('anchor_blocked', { depth: depths[centerIdx], minDepth: MIN_DEPTH });
  }

  let leftIdx = centerIdx;
  let rightIdx = centerIdx;
  while (leftIdx > 0 && depths[leftIdx - 1] >= MIN_DEPTH) leftIdx--;
  while (rightIdx < depths.length - 1 && depths[rightIdx + 1] >= MIN_DEPTH) rightIdx++;

  const usableWidth = xs[rightIdx] - xs[leftIdx];
  if (usableWidth < frontMin) {
    const envelope = buildEnvelopeFailure(
      anchorX, anchorY, tx, ty, nx, ny,
      clearance, xs, depths, leftIdx, rightIdx,
      simTime, 'usable_width_too_small',
    );
    if (envelope) {
      console.log('[spawn] fail: usable_width_too_small', {
        edgeId: edge.id,
        type: typeName,
        anchor: { x: anchorX, y: anchorY },
        usableWidth,
        frontMin,
      });
      return { kind: 'failure', failure: envelope };
    }
    return fail('usable_width_too_small', { usableWidth, frontMin });
  }

  // Wise picking already chose W ≤ frontMax + SLIVER_GAP, so no further
  // width-trim — that would re-create the sliver we deliberately absorbed.
  const useLeft = leftIdx;
  const useRight = rightIdx;
  const finalWidth = xs[useRight] - xs[useLeft];
  if (finalWidth < frontMin) return fail('final_width_too_small', { finalWidth, frontMin });

  let lastBuilt: PlacedPoly | null = null;
  for (const factor of SHRINK_FACTORS) {
    const targetArea = typeDef.targetArea * factor;
    const built = buildPolygon(
      anchorX,
      anchorY,
      tx,
      ty,
      nx,
      ny,
      clearance,
      xs,
      depths,
      useLeft,
      useRight,
      finalWidth,
      targetArea,
    );
    if (!built) continue;
    lastBuilt = built;
    if (built.area >= targetArea * MIN_AREA_RATIO) {
      // When the building reaches a layout boundary (no depth trim), use the
      // boundary's direct formula so adjacent buildings' consumed ranges
      // bit-match — otherwise FP drift between the xs-based path and the
      // stored interval boundary leaves a sub-meter residual sliver.
      const consumedT0 =
        useLeft === 0
          ? Math.max(0, ivT0 + layout.start / len)
          : Math.max(0, t + xs[useLeft] / len);
      const consumedT1 =
        useRight === xs.length - 1
          ? Math.min(1, ivT0 + (layout.start + W) / len)
          : Math.min(1, t + xs[useRight] / len);
      return {
        kind: 'success',
        building: {
          type: typeName,
          poly: built.poly,
          centroid: built.centroid,
          aabb: built.aabb,
          spawnedAt: simTime,
        },
        consumed: {
          edgeId: edge.id,
          side: pickSide,
          t0: consumedT0,
          t1: consumedT1,
        },
      };
    }
  }

  if (lastBuilt) {
    console.log('[spawn] fail: area_below_threshold', {
      edgeId: edge.id,
      type: typeName,
      area: lastBuilt.area,
      targetArea: typeDef.targetArea,
      minRatio: MIN_AREA_RATIO,
    });
    return {
      kind: 'failure',
      failure: {
        poly: lastBuilt.poly,
        centroid: lastBuilt.centroid,
        aabb: lastBuilt.aabb,
        spawnedAt: simTime,
        reason: 'area_below_threshold',
      },
    };
  }
  return fail('no_polygon_buildable', { finalWidth, targetArea: typeDef.targetArea });
}

// ---------- polygon construction ----------

interface PlacedPoly {
  poly: number[];
  centroid: { x: number; y: number };
  aabb: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
}

function buildPolygon(
  anchorX: number,
  anchorY: number,
  tx: number,
  ty: number,
  nx: number,
  ny: number,
  clearance: number,
  xs: number[],
  depths: number[],
  useLeft: number,
  useRight: number,
  finalWidth: number,
  targetArea: number,
): PlacedPoly | null {
  const desiredDepth = targetArea / finalWidth;

  const local: number[] = [];
  local.push(xs[useLeft], clearance);
  local.push(xs[useRight], clearance);
  for (let i = useRight; i >= useLeft; i--) {
    const cap = Math.min(desiredDepth, depths[i]);
    if (cap < MIN_DEPTH) return null;
    local.push(xs[i], clearance + cap);
  }

  const simplified = simplifyAxisAligned(local);
  if (simplified.length < 8) return null;

  const world = transformLocalToWorld(simplified, anchorX, anchorY, tx, ty, nx, ny);
  return {
    poly: world,
    centroid: polyCentroid(world),
    aabb: polyAabb(world),
    area: polyArea(world),
  };
}

function transformLocalToWorld(
  local: number[],
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  nx: number,
  ny: number,
): number[] {
  const out = new Array(local.length);
  for (let i = 0; i < local.length; i += 2) {
    const lx = local[i];
    const ly = local[i + 1];
    out[i] = ax + tx * lx + nx * ly;
    out[i + 1] = ay + ty * lx + ny * ly;
  }
  return out;
}

function simplifyAxisAligned(poly: number[]): number[] {
  const n = poly.length / 2;
  if (n < 4) return poly;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const px = poly[2 * prev];
    const py = poly[2 * prev + 1];
    const cx = poly[2 * i];
    const cy = poly[2 * i + 1];
    const nxv = poly[2 * next];
    const nyv = poly[2 * next + 1];
    const ax = cx - px;
    const ay = cy - py;
    const bx = nxv - cx;
    const by = nyv - cy;
    if (Math.abs(ax * by - ay * bx) < 1e-6) continue;
    out.push(cx, cy);
  }
  return out.length >= 8 ? out : poly;
}

// Traces the actual free envelope spanning [leftIdx..rightIdx] using each
// slice's measured depth. Used so usable_width_too_small failures visualize
// the real available region, not a generic placeholder rect. Returns null if
// the envelope is too degenerate to render.
function buildEnvelopeFailure(
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  nx: number,
  ny: number,
  clearance: number,
  xs: number[],
  depths: number[],
  leftIdx: number,
  rightIdx: number,
  simTime: number,
  reason: string,
): Omit<FailedAttempt, 'id'> | null {
  if (rightIdx <= leftIdx) return null;
  const local: number[] = [];
  local.push(xs[leftIdx], clearance);
  local.push(xs[rightIdx], clearance);
  for (let i = rightIdx; i >= leftIdx; i--) {
    local.push(xs[i], clearance + depths[i]);
  }
  const simplified = simplifyAxisAligned(local);
  if (simplified.length < 8) return null;
  const poly = transformLocalToWorld(simplified, ax, ay, tx, ty, nx, ny);
  return {
    poly,
    centroid: polyCentroid(poly),
    aabb: polyAabb(poly),
    spawnedAt: simTime,
    reason,
  };
}

// Small placeholder rect at the anchor, oriented to the road frame. Used to
// visualize failures that didn't reach the polygon-construction stage so the
// user can still see *where* attempts are happening.
function makePlaceholder(
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  nx: number,
  ny: number,
  clearance: number,
  simTime: number,
  reason: string,
): Omit<FailedAttempt, 'id'> {
  const w = PLACEHOLDER_W;
  const h = PLACEHOLDER_H;
  const local = [
    -w / 2,
    clearance,
    w / 2,
    clearance,
    w / 2,
    clearance + h,
    -w / 2,
    clearance + h,
  ];
  const poly = transformLocalToWorld(local, ax, ay, tx, ty, nx, ny);
  return {
    poly,
    centroid: polyCentroid(poly),
    aabb: polyAabb(poly),
    spawnedAt: simTime,
    reason,
  };
}

// ---------- raycasts ----------

function freeDepthAt(
  ctx: SpawnContext,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
  for (const b of ctx.buildings) {
    if (!aabbContainsPoint(b.aabb, ox, oy)) continue;
    if (pointInPoly(b.poly, ox, oy)) return 0;
  }

  let best = maxT;

  for (const e of ctx.graph.edges.values()) {
    const a = ctx.graph.nodes.get(e.from)!;
    const b = ctx.graph.nodes.get(e.to)!;
    const halfW = ROAD_HALF_WIDTH[e.kind] + EDGE_CLEARANCE;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    const t = rayHitOBB(
      ox,
      oy,
      dx,
      dy,
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      len,
      halfW * 2,
      Math.atan2(ey, ex),
      best,
    );
    if (t < best) best = t;
  }

  for (const b of ctx.buildings) {
    const rayMinX = dx >= 0 ? ox : ox + dx * best;
    const rayMaxX = dx >= 0 ? ox + dx * best : ox;
    const rayMinY = dy >= 0 ? oy : oy + dy * best;
    const rayMaxY = dy >= 0 ? oy + dy * best : oy;
    if (
      b.aabb.maxX < rayMinX ||
      b.aabb.minX > rayMaxX ||
      b.aabb.maxY < rayMinY ||
      b.aabb.minY > rayMaxY
    ) {
      continue;
    }
    const t = rayHitPolygon(b.poly, ox, oy, dx, dy, best);
    if (t < best) best = t;
  }

  return best;
}

function rayHitOBB(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rot: number,
  maxT: number,
): number {
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const tx = ox - cx;
  const ty = oy - cy;
  const lx = tx * c - ty * s;
  const ly = tx * s + ty * c;
  const ldx = dx * c - dy * s;
  const ldy = dx * s + dy * c;

  const hw = w / 2;
  const hh = h / 2;

  if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return 0;

  let tmin = -Infinity;
  let tmax = Infinity;

  if (Math.abs(ldx) < 1e-9) {
    if (lx < -hw || lx > hw) return Infinity;
  } else {
    const t1 = (-hw - lx) / ldx;
    const t2 = (hw - lx) / ldx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(ldy) < 1e-9) {
    if (ly < -hh || ly > hh) return Infinity;
  } else {
    const t1 = (-hh - ly) / ldy;
    const t2 = (hh - ly) / ldy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return Infinity;
  }

  if (tmin < 0 || tmin > maxT) return Infinity;
  return tmin;
}

function rayHitPolygon(
  poly: number[],
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
  let best = maxT;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t = rayHitSegment(
      ox,
      oy,
      dx,
      dy,
      poly[2 * i],
      poly[2 * i + 1],
      poly[2 * j],
      poly[2 * j + 1],
    );
    if (t > 0 && t < best) best = t;
  }
  return best;
}

function rayHitSegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const ex = x1 - x0;
  const ey = y1 - y0;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-9) return Infinity;
  const inv = 1 / denom;
  const t = ((x0 - ox) * ey - (y0 - oy) * ex) * inv;
  const s = ((x0 - ox) * dy - (y0 - oy) * dx) * inv;
  if (t < 0 || s < 0 || s > 1) return Infinity;
  return t;
}
