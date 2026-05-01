import type { Anchor, EdgeKind, Graph } from '@game/graph';
import type { Building, BuildingId } from '@game/buildings';
import { predictRoadBulldoze } from '@game/buildings/bulldoze';
import { findRoadCrossings } from '@game/roads/crossings';
import { snapToAnchor, type SnapResult } from './snap';
import { subdivideStraight } from './subdivide';

export type DrawCommitResult =
  | { kind: 'begin'; drawingStart: SnapResult }
  | { kind: 'cancel' }
  | { kind: 'commit'; drawingStart: SnapResult | null; bulldozeIds: BuildingId[] };

// On first click: stash the snap as drawingStart (begin).
// On subsequent click at the same node: cancel.
// Otherwise: commit — predict any overlapping buildings to bulldoze, split
// intersected edges, drop ~100m midpoints between fixed points, insert the
// resulting chain. Returns the new end-node anchor and the predicted
// bulldoze list. The caller (worldStore) actually performs the bulldozes
// and reconciles the graph delta so all state-mutation flows through one
// orchestrator.
export function beginOrCommitDraw(
  graph: Graph,
  buildings: Building[],
  drawingStart: SnapResult | null,
  snap: SnapResult,
  kind: EdgeKind,
): DrawCommitResult {
  if (!drawingStart) return { kind: 'begin', drawingStart: snap };
  if (
    drawingStart.kind === 'node' &&
    snap.kind === 'node' &&
    drawingStart.nodeId === snap.nodeId
  ) {
    return { kind: 'cancel' };
  }

  // Capture predicted bulldoze targets BEFORE insertEdge — split anchors
  // mutate the graph and would shift edge ids, but the buildings list is
  // keyed by stable building id.
  const bulldozeIds = predictRoadBulldoze(drawingStart, snap, kind, buildings);
  // Crossings → split anchors so existing edge and new line share the node.
  // Computed BEFORE any insertEdge so edge ids are stable.
  const crossings = findRoadCrossings(graph, drawingStart, snap);
  // Walk segments separated by crossings, dropping ~100m midpoints inside
  // each. Crossings act as fixed dividers, so midpoints never crowd them.
  const waypoints: Anchor[] = [];
  let px = drawingStart.x;
  let py = drawingStart.y;
  for (const c of crossings) {
    for (const m of subdivideStraight(px, py, c.x, c.y)) {
      waypoints.push({ kind: 'free', x: m.x, y: m.y });
    }
    waypoints.push({ kind: 'split', edgeId: c.edgeId, t: c.s });
    px = c.x;
    py = c.y;
  }
  for (const m of subdivideStraight(px, py, snap.x, snap.y)) {
    waypoints.push({ kind: 'free', x: m.x, y: m.y });
  }

  let currentAnchor: Anchor = snapToAnchor(drawingStart);
  let lastResult: ReturnType<typeof graph.insertEdge> = null;
  for (const w of waypoints) {
    const r = graph.insertEdge(currentAnchor, w, kind);
    if (!r) continue;
    currentAnchor = { kind: 'node', nodeId: r.toId };
    lastResult = r;
  }
  const finalResult = graph.insertEdge(currentAnchor, snapToAnchor(snap), kind);
  if (finalResult) lastResult = finalResult;

  if (!lastResult) return { kind: 'commit', drawingStart: null, bulldozeIds: [] };

  const endNode = graph.nodes.get(lastResult.toId);
  return {
    kind: 'commit',
    drawingStart: endNode
      ? { kind: 'node', nodeId: endNode.id, x: endNode.x, y: endNode.y }
      : null,
    bulldozeIds,
  };
}
