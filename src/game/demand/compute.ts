import type { Graph, NodeId } from '@game/graph';
import { forEachCellInRadius, type CellMap } from './cellMap';
import type { RoadField } from './roadField';

// Recompute a node-keyed road field by integrating cells around each node with
// linear distance falloff. Result is the weighted average over the disc, so
// values stay in the same scale as the cell data (typically [0..1]).
export function sampleCellsToRoadField(
  cellMap: CellMap,
  graph: Graph,
  field: RoadField,
  radius: number,
): void {
  field.clear();
  for (const node of graph.nodes.values()) {
    let weighted = 0;
    let totalWeight = 0;
    forEachCellInRadius(cellMap, node.x, node.y, radius, (v, d) => {
      const w = 1 - d / radius;
      weighted += v * w;
      totalWeight += w;
    });
    if (totalWeight === 0) continue;
    const avg = weighted / totalWeight;
    if (avg > 1e-4) field.set(node.id, avg);
  }
}

// Splat a node-keyed road field into the cell map for visualization by
// walking each edge: at cell-sized steps along the edge, lerp the value
// between the two endpoint road-field values and splat a small radial
// falloff. The visible heatmap then mirrors what the road overlay shows
// instead of producing disconnected blobs around each node.
export function splatRoadFieldToCells(
  field: RoadField,
  graph: Graph,
  cellMap: CellMap,
  radius: number,
): void {
  cellMap.data.fill(0);
  for (const e of graph.edges.values()) {
    const va = field.get(e.from) ?? 0;
    const vb = field.get(e.to) ?? 0;
    if (va <= 0 && vb <= 0) continue;
    const a = graph.nodes.get(e.from)!;
    const b = graph.nodes.get(e.to)!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const steps = Math.max(2, Math.ceil(len / cellMap.cellSize));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = a.x + dx * t;
      const sy = a.y + dy * t;
      const sv = va + (vb - va) * t;
      if (sv <= 0) continue;
      forEachCellInRadius(cellMap, sx, sy, radius, (_, d, ci, cj) => {
        const idx = cj * cellMap.cols + ci;
        const v = sv * (1 - d / radius);
        if (v > cellMap.data[idx]) cellMap.data[idx] = v;
      });
    }
  }
}

// Total resource value the road network has spatial reach into. For each
// graph node, marks every cell within `radius` as covered; then sums covered
// cells' values once (each cell counted at most once, regardless of how many
// node discs it falls inside) and scales by cell area so the result is in
// "resource-value × m²" — units of "amount of resource the network can
// consume". Monotonic in road coverage of the cell layer; unaffected by
// densifying roads in already-covered regions.
export function reachableCellSum(cellMap: CellMap, graph: Graph, radius: number): number {
  const covered = new Uint8Array(cellMap.cols * cellMap.rows);
  for (const node of graph.nodes.values()) {
    forEachCellInRadius(cellMap, node.x, node.y, radius, (_v, _d, i, j) => {
      covered[j * cellMap.cols + i] = 1;
    });
  }
  let sum = 0;
  for (let i = 0; i < cellMap.data.length; i++) {
    if (covered[i]) sum += cellMap.data[i];
  }
  return sum * cellMap.cellSize * cellMap.cellSize;
}

// Distance-decayed flood fill from `startNode` along graph edges. Each hop
// multiplies the carried value by `decay`; if a node is reached by multiple
// paths, the larger value wins. Adds the result onto `out` (sum across calls)
// so multiple sources can be accumulated. Skips below 1e-2 to terminate.
export function bfsDecay(
  graph: Graph,
  startNode: NodeId,
  startValue: number,
  decay: number,
  out: RoadField,
): void {
  const reached = new Map<NodeId, number>();
  reached.set(startNode, startValue);
  const queue: NodeId[] = [startNode];
  while (queue.length > 0) {
    const n = queue.shift()!;
    const v = reached.get(n)!;
    const next = v * decay;
    if (next < 1e-2) continue;
    const node = graph.nodes.get(n);
    if (!node) continue;
    for (const eid of node.edges) {
      const e = graph.edges.get(eid);
      if (!e) continue;
      const other = e.from === n ? e.to : e.from;
      const existing = reached.get(other) ?? 0;
      if (next > existing) {
        reached.set(other, next);
        queue.push(other);
      }
    }
  }
  for (const [n, v] of reached) {
    out.set(n, (out.get(n) ?? 0) + v);
  }
}
