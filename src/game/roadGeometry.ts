import type { EdgeId, EdgeKind, Graph } from './graph';

export const ROAD_HALF_WIDTH: Record<EdgeKind, number> = {
  road: 4,
  small_road: 2,
  path: 1,
};
export const EDGE_CLEARANCE = 0.5;

export type Side = 'left' | 'right';
export type EdgeEnd = 'from' | 'to';

export function sideOffset(kind: EdgeKind): number {
  return ROAD_HALF_WIDTH[kind] + EDGE_CLEARANCE;
}

export function sideNormal(
  tx: number,
  ty: number,
  side: Side,
): { nx: number; ny: number } {
  return side === 'left' ? { nx: -ty, ny: tx } : { nx: ty, ny: -tx };
}

export interface CornerPoint {
  x: number;
  y: number;
}

// Caps the miter when an outside corner is very acute, to avoid the offset
// shooting off to infinity. Measured in multiples of the edge's side offset.
const MITER_LIMIT = 6;

// At every node, miter the offset polylines of incident edges so that on
// inside corners they retract to meet, and on outside corners they extend
// to meet. Returns a map keyed by `${edgeId}:${side}:${end}` (where end is
// 'from' or 'to'). Edges at degree-1 nodes get no override at that end.
export function computeFrontageCorners(graph: Graph): Map<string, CornerPoint> {
  const out = new Map<string, CornerPoint>();

  for (const node of graph.nodes.values()) {
    if (node.edges.size < 2) continue;

    interface Item {
      edgeId: EdgeId;
      end: EdgeEnd;
      ccwSide: Side;
      cwSide: Side;
      lx: number;
      ly: number;
      off: number;
      angle: number;
    }
    const items: Item[] = [];
    for (const eid of node.edges) {
      const e = graph.edges.get(eid);
      if (!e) continue;
      const isFrom = e.from === node.id;
      const other = graph.nodes.get(isFrom ? e.to : e.from);
      if (!other) continue;
      const dx = other.x - node.x;
      const dy = other.y - node.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      items.push({
        edgeId: eid,
        end: isFrom ? 'from' : 'to',
        ccwSide: isFrom ? 'left' : 'right',
        cwSide: isFrom ? 'right' : 'left',
        lx: dx / len,
        ly: dy / len,
        off: sideOffset(e.kind),
        angle: Math.atan2(dy, dx),
      });
    }
    if (items.length < 2) continue;
    items.sort((a, b) => a.angle - b.angle);

    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const b = items[(i + 1) % items.length];
      // Wedge bounded by a's CCW-leaving side and b's CW-leaving side.
      const nAx = -a.ly;
      const nAy = a.lx;
      const nBx = b.ly;
      const nBy = -b.lx;
      const PAx = node.x + nAx * a.off;
      const PAy = node.y + nAy * a.off;
      const PBx = node.x + nBx * b.off;
      const PBy = node.y + nBy * b.off;

      const cross = a.lx * b.ly - a.ly * b.lx;
      let cx: number;
      let cy: number;
      const cap = Math.max(a.off, b.off) * MITER_LIMIT;
      if (Math.abs(cross) < 1e-6) {
        // Edges are colinear (180° pass-through). Offset endpoints already line up.
        cx = PAx;
        cy = PAy;
      } else {
        const s = ((PBx - PAx) * b.ly - (PBy - PAy) * b.lx) / cross;
        const sClamped = Math.max(-cap, Math.min(cap, s));
        cx = PAx + a.lx * sClamped;
        cy = PAy + a.ly * sClamped;
      }

      out.set(cornerKey(a.edgeId, a.ccwSide, a.end), { x: cx, y: cy });
      out.set(cornerKey(b.edgeId, b.cwSide, b.end), { x: cx, y: cy });
    }
  }

  return out;
}

export function cornerKey(edgeId: EdgeId, side: Side, end: EdgeEnd): string {
  return `${edgeId}:${side}:${end}`;
}
