import type { Graph } from '@game/graph';
import type { Building } from '@game/buildings';
import {
  CELL_SAMPLE_RADIUS,
  CELL_SIZE,
  FIELD_SPLAT_RADIUS,
  GRID_RES,
  SOURCE_ANCHOR_RADIUS,
  WORLD_MIN,
} from '@game/sim/config';
import { createCellMap, type CellMap } from './cellMap';
import { createRoadField, type RoadField } from './roadField';
import {
  bfsDecay,
  reachableCellSum,
  sampleCellsToRoadField,
  splatRoadFieldToCells,
} from './compute';
import { seedResourceBlobs } from './seed';
import { DEMAND_TYPES, type DemandDef, type Palette } from './types';
import {
  slotsGivenBy,
  type AttributionLedgers,
} from '@game/sim/attribution';

interface RecomputeCtx {
  graph: Graph;
  buildings: Building[];
  ledgers: AttributionLedgers;
}

export interface DemandMap {
  readonly id: string;
  readonly label: string;
  readonly palette: Palette;
  readonly cellMap: CellMap;
  readonly roadField: RoadField;
  // Cell-sourced only: total resource the road network can reach (in
  // resource-value × m² units), recomputed alongside roadField. 0 for
  // building-sourced maps. Read by globalAvail() to derive cap.
  reachableSum: number;
  // Palette saturation for the road-overlay graph: max road-field value
  // across nodes (live, all demand types). Same value the spawn picker
  // ranges over.
  graphSat: number;
  // Palette saturation for the cell heatmap. Building-sourced: same as
  // graphSat (cells are splatted from the road field). Cell-sourced: 1
  // (cell values are raw 0..1 noise; max-field would saturate empty maps
  // when no roads exist).
  cellSat: number;
  recompute(ctx: RecomputeCtx): void;
}

function createDemandMap(def: DemandDef, seed: number): DemandMap {
  const cellMap = createCellMap(GRID_RES, GRID_RES, CELL_SIZE, WORLD_MIN, WORLD_MIN);
  const roadField = createRoadField();

  if (def.source.kind === 'cells') {
    seedResourceBlobs(cellMap, seed);
    const map: DemandMap = {
      id: def.id,
      label: def.label,
      palette: def.palette,
      cellMap,
      roadField,
      reachableSum: 0,
      graphSat: 1,
      cellSat: 1,
      recompute: (ctx) => {
        sampleCellsToRoadField(cellMap, ctx.graph, roadField, CELL_SAMPLE_RADIUS);
        map.reachableSum = reachableCellSum(cellMap, ctx.graph, CELL_SAMPLE_RADIUS);
        let max = 0;
        for (const v of roadField.values()) if (v > max) max = v;
        map.graphSat = Math.max(max, 1e-3);
      },
    };
    return map;
  }

  // Building-sourced: each source broadcasts (capacity − slots-given-out)
  // along the graph with decay, summed across sources.
  const sourceType = def.source.type;
  const capacity = def.source.capacity;
  const map: DemandMap = {
    id: def.id,
    label: def.label,
    palette: def.palette,
    cellMap,
    roadField,
    reachableSum: 0,
    graphSat: 1,
    cellSat: 1,
    recompute: (ctx) => {
      roadField.clear();
      const ledger = ctx.ledgers.get(def.id)!;
      for (const b of ctx.buildings) {
        if (b.type !== sourceType) continue;
        const remaining = capacity - slotsGivenBy(ledger, b.id);
        if (remaining <= 0) continue;
        const node = ctx.graph.nearestNode(b.centroid.x, b.centroid.y, SOURCE_ANCHOR_RADIUS);
        if (!node) continue;
        bfsDecay(ctx.graph, node.id, remaining, def.decay, roadField);
      }
      let max = 0;
      for (const v of roadField.values()) if (v > max) max = v;
      const sat = Math.max(max, 1e-3);
      map.graphSat = sat;
      map.cellSat = sat;
      splatRoadFieldToCells(roadField, ctx.graph, cellMap, FIELD_SPLAT_RADIUS);
    },
  };
  return map;
}

export function createDemandMaps(seed: number): DemandMap[] {
  return DEMAND_TYPES.map((def) => createDemandMap(def, seed));
}
