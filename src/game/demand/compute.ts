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

// Splat a node-keyed road field into the cell map for visualization. Cells
// take the MAX of the linearly-falling-off value from any nearby node — this
// keeps overlapping hot zones from compounding past the field's natural range.
export function splatRoadFieldToCells(
  field: RoadField,
  graph: Graph,
  cellMap: CellMap,
  radius: number,
): void {
  cellMap.data.fill(0);
  for (const [nodeId, value] of field) {
    if (value <= 0) continue;
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    forEachCellInRadius(cellMap, node.x, node.y, radius, (_, d, i, j) => {
      const idx = j * cellMap.cols + i;
      const v = value * (1 - d / radius);
      if (v > cellMap.data[idx]) cellMap.data[idx] = v;
    });
  }
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
