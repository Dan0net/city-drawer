import type { Graph } from '@game/graph';
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
