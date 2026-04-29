import type { EdgeId, Graph, NodeId } from '@game/graph';
import type { Building, BuildingId } from '@game/buildings';
import {
  buildingAtPoint,
  buildingsWithPrimaryOn,
  predictRoadBulldoze,
} from '@game/buildings/bulldoze';
import { findRoadCrossings } from '@game/roads/crossings';
import { applyDrawSnap, computeSnap, type SnapResult } from './snap';
import { subdivideStraight } from './subdivide';

export type Tool = 'none' | 'road' | 'small_road' | 'path' | 'bulldoze';

export type BulldozeHover =
  | { kind: 'edge'; id: EdgeId }
  | { kind: 'node'; id: NodeId }
  | { kind: 'building'; id: BuildingId };

interface PointerState {
  pointerWorld: { x: number; y: number };
  snap: SnapResult | null;
  bulldozeHover: BulldozeHover | null;
  bulldozePreview: BuildingId[];
  drawingCrossings: { x: number; y: number }[];
  drawingMidpoints: { x: number; y: number }[];
}

const empty = (
  pointerWorld: { x: number; y: number },
  snap: SnapResult | null,
  bulldozeHover: BulldozeHover | null,
  bulldozePreview: BuildingId[] = [],
): PointerState => ({
  pointerWorld,
  snap,
  bulldozeHover,
  bulldozePreview,
  drawingCrossings: [],
  drawingMidpoints: [],
});

// Pure: derives the pointer/snap/preview/hover state from world inputs. The
// caller passes `snapDraw` (a UI preference) so this module has no UI-store
// coupling.
export function computePointerState(
  graph: Graph,
  buildings: Building[],
  tool: Tool,
  drawingStart: SnapResult | null,
  x: number,
  y: number,
  radius: number,
  opts: { snapDraw: boolean },
): PointerState {
  const pointerWorld = { x, y };

  if (tool === 'road' || tool === 'small_road' || tool === 'path') {
    let snap = computeSnap(graph, x, y, radius);
    // Snap to existing node/edge always wins over angle+length snap so users
    // can still aim at intersections and split points exactly.
    if (drawingStart && snap.kind === 'free' && opts.snapDraw) {
      snap = applyDrawSnap(graph, drawingStart, snap);
    }
    const bulldozePreview = drawingStart
      ? predictRoadBulldoze(drawingStart, snap, tool, buildings)
      : [];
    const crossings = drawingStart ? findRoadCrossings(graph, drawingStart, snap) : [];
    // Midpoints subdivide each sub-segment between consecutive fixed points
    // (start → crossing → crossing → end), so they can never land closer
    // than ~50m to a crossing.
    const drawingMidpoints: { x: number; y: number }[] = [];
    if (drawingStart) {
      let px = drawingStart.x;
      let py = drawingStart.y;
      for (const c of crossings) {
        for (const m of subdivideStraight(px, py, c.x, c.y)) {
          drawingMidpoints.push({ x: m.x, y: m.y });
        }
        px = c.x;
        py = c.y;
      }
      for (const m of subdivideStraight(px, py, snap.x, snap.y)) {
        drawingMidpoints.push({ x: m.x, y: m.y });
      }
    }
    return {
      pointerWorld,
      snap,
      bulldozeHover: null,
      bulldozePreview,
      drawingCrossings: crossings.map((c) => ({ x: c.x, y: c.y })),
      drawingMidpoints,
    };
  }

  if (tool === 'bulldoze') {
    const b = buildingAtPoint(buildings, x, y);
    if (b) return empty(pointerWorld, null, { kind: 'building', id: b.id });
    const node = graph.nearestNode(x, y, radius);
    if (node) {
      return empty(
        pointerWorld,
        null,
        { kind: 'node', id: node.id },
        buildingsWithPrimaryOn(node.edges, buildings),
      );
    }
    const edge = graph.nearestEdge(x, y, radius);
    return empty(
      pointerWorld,
      null,
      edge ? { kind: 'edge', id: edge.edge.id } : null,
      edge ? buildingsWithPrimaryOn(new Set([edge.edge.id]), buildings) : [],
    );
  }

  return empty(pointerWorld, null, null);
}
