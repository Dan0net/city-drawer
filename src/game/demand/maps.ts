import type { Graph } from '@game/graph';
import { createCellMap, type CellMap } from './cellMap';
import { createRoadField, type RoadField } from './roadField';
import { sampleCellsToRoadField } from './compute';
import { seedResourceBlobs } from './seed';

// World-aligned grid covering 4096×4096 m centered on the origin, sampled at
// ~16 m/cell. Step 1 ships one map; the registry generalizes to many.
const WORLD_SIZE = 4096;
const WORLD_MIN = -WORLD_SIZE / 2;
const GRID_RES = 256;
const CELL_SIZE = WORLD_SIZE / GRID_RES;

// How far around each node we integrate cell values to derive its road-field
// entry. ~3 cells of reach feels right for "the road touches this resource".
const ROAD_SAMPLE_RADIUS = CELL_SIZE * 3;

type DemandMapKind = 'cell-sourced' | 'graph-sourced' | 'emission-sourced';

// 0..1 → [r,g,b,a] in 0..255. Keeps texture build allocation-free.
type Palette = (v: number, out: Uint8Array, offset: number) => void;

export interface DemandMap {
  readonly id: string;
  readonly label: string;
  readonly kind: DemandMapKind;
  readonly palette: Palette;
  readonly cellMap: CellMap;
  readonly roadField: RoadField;
  // Refresh the derived side from the canonical side. For cell-sourced maps,
  // recomputes the road field from the cell data; for graph-sourced (later),
  // splats road values into cells.
  recompute(graph: Graph): void;
}

const resourcePalette: Palette = (v, out, o) => {
  // Transparent → warm ochre. Smooth ramp; gamma-ish curve.
  const k = Math.max(0, Math.min(1, v));
  out[o] = Math.round(120 + 135 * k);
  out[o + 1] = Math.round(70 + 90 * k);
  out[o + 2] = Math.round(20 + 30 * k);
  out[o + 3] = Math.round(220 * k);
};

function createResourceMap(seed: number): DemandMap {
  const cellMap = createCellMap(GRID_RES, GRID_RES, CELL_SIZE, WORLD_MIN, WORLD_MIN);
  seedResourceBlobs(cellMap, seed);
  const roadField = createRoadField();
  return {
    id: 'resource',
    label: 'resource',
    kind: 'cell-sourced',
    palette: resourcePalette,
    cellMap,
    roadField,
    recompute(graph) {
      sampleCellsToRoadField(cellMap, graph, roadField, ROAD_SAMPLE_RADIUS);
    },
  };
}

export function createDemandMaps(seed: number): DemandMap[] {
  return [createResourceMap(seed)];
}
