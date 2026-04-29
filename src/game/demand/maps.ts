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
import { bfsDecay, sampleCellsToRoadField, splatRoadFieldToCells } from './compute';
import { seedResourceBlobs } from './seed';
import { DEMAND_TYPES, type DemandDef, type Palette } from './types';

interface RecomputeCtx {
  graph: Graph;
  buildings: Building[];
}

export interface DemandMap {
  readonly id: string;
  readonly label: string;
  readonly palette: Palette;
  readonly cellMap: CellMap;
  readonly roadField: RoadField;
  recompute(ctx: RecomputeCtx): void;
}

const filledOf = (b: Building, def: DemandDef): number => b.filled?.[def.id] ?? 0;

function createDemandMap(def: DemandDef, seed: number): DemandMap {
  const cellMap = createCellMap(GRID_RES, GRID_RES, CELL_SIZE, WORLD_MIN, WORLD_MIN);
  const roadField = createRoadField();

  if (def.source.kind === 'cells') {
    seedResourceBlobs(cellMap, seed);
    return {
      id: def.id,
      label: def.label,
      palette: def.palette,
      cellMap,
      roadField,
      recompute: (ctx) => sampleCellsToRoadField(cellMap, ctx.graph, roadField, CELL_SAMPLE_RADIUS),
    };
  }

  // Building-sourced: each source broadcasts (capacity − filled[id]) along the
  // graph with decay, summed across sources.
  const sourceType = def.source.type;
  const capacity = def.source.capacity;
  return {
    id: def.id,
    label: def.label,
    palette: def.palette,
    cellMap,
    roadField,
    recompute: (ctx) => {
      roadField.clear();
      for (const b of ctx.buildings) {
        if (b.type !== sourceType) continue;
        const remaining = capacity - filledOf(b, def);
        if (remaining <= 0) continue;
        const node = ctx.graph.nearestNode(b.centroid.x, b.centroid.y, SOURCE_ANCHOR_RADIUS);
        if (!node) continue;
        bfsDecay(ctx.graph, node.id, remaining, def.decay, roadField);
      }
      splatRoadFieldToCells(roadField, ctx.graph, cellMap, FIELD_SPLAT_RADIUS);
    },
  };
}

export function createDemandMaps(seed: number): DemandMap[] {
  return DEMAND_TYPES.map((def) => createDemandMap(def, seed));
}
