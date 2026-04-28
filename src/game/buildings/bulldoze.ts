import type { Graph, EdgeId, EdgeKind } from '@game/graph';
import type { Building, BuildingId } from './';
import { sideOffset } from '@game/roads/geometry';
import { aabbContainsPoint } from '@lib/aabb';
import { pointInPoly, polyOverlapsObb } from '@lib/poly';

export const buildingAtPoint = (buildings: Building[], x: number, y: number): Building | null => {
  // Iterate newest-first so the topmost overlap wins.
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (!aabbContainsPoint(b.aabb, x, y)) continue;
    if (pointInPoly(b.poly, x, y)) return b;
  }
  return null;
};

// Buildings the OBB (start, end, kind-derived width) would overlap.
export const predictRoadBulldoze = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  kind: EdgeKind,
  buildings: Building[],
): BuildingId[] => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;
  const rot = Math.atan2(dy, dx);
  const width = 2 * sideOffset(kind);
  const out: BuildingId[] = [];
  for (const b of buildings) {
    if (polyOverlapsObb(b.poly, cx, cy, len, width, rot)) out.push(b.id);
  }
  return out;
};

export const buildingsWithPrimaryOn = (
  edgeIds: Set<EdgeId>,
  buildings: Building[],
): BuildingId[] => {
  const out: BuildingId[] = [];
  for (const b of buildings) {
    const primaryEdge = b.consumed[0]?.edgeId;
    if (primaryEdge != null && edgeIds.has(primaryEdge)) out.push(b.id);
  }
  return out;
};

// Removes a single building, restoring its consumed frontages on every edge
// other than `excludeEdgeIds` (which we're about to delete). If the removed
// building was attributed to another (house→factory, shop→house, park→house),
// decrements the appropriate counter on the attributed-to building. Returns
// true if any frontage was actually restored.
export const removeBuildingRestoring = (
  graph: Graph,
  buildings: Building[],
  buildingId: BuildingId,
  excludeEdgeIds: Set<EdgeId> | null,
): boolean => {
  const idx = buildings.findIndex((b) => b.id === buildingId);
  if (idx < 0) return false;
  const b = buildings[idx];
  buildings.splice(idx, 1);
  if (b.attributedToIds) {
    for (const id of b.attributedToIds) {
      const target = buildings.find((x) => x.id === id);
      if (!target) continue;
      if (b.type === 'small_house' && target.jobsFilled != null && target.jobsFilled > 0) {
        target.jobsFilled--;
      } else if (b.type === 'shop' && target.commercialFilled != null && target.commercialFilled > 0) {
        target.commercialFilled--;
      } else if (b.type === 'park' && target.leisureFilled != null && target.leisureFilled > 0) {
        target.leisureFilled--;
      }
    }
  }
  let restored = false;
  for (const c of b.consumed) {
    if (excludeEdgeIds && excludeEdgeIds.has(c.edgeId)) continue;
    if (graph.restoreFrontage(c.edgeId, c.side, c.t0, c.t1)) restored = true;
  }
  return restored;
};
