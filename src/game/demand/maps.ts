import type { Graph } from '@game/graph';
import type { Building } from '@game/buildings';
import { createCellMap, type CellMap } from './cellMap';
import { createRoadField, type RoadField } from './roadField';
import { bfsDecay, sampleCellsToRoadField, splatRoadFieldToCells } from './compute';
import { seedResourceBlobs } from './seed';

interface RecomputeCtx {
  graph: Graph;
  buildings: Building[];
}

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
  // recomputes the road field from the cell data; for graph-sourced maps,
  // accumulates per-building contributions into the road field via BFS.
  recompute(ctx: RecomputeCtx): void;
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
    recompute(ctx) {
      sampleCellsToRoadField(cellMap, ctx.graph, roadField, ROAD_SAMPLE_RADIUS);
    },
  };
}

// Jobs are supplied by factories and consumed by houses. The map shows net
// supply along the graph: each factory floods JOB_SUPPLY value into its
// nearest node and decays away each hop; each house subtracts JOB_DEMAND
// from its nearest node.
const JOB_SUPPLY = 100;
const JOB_DEMAND = 30;
const JOB_DECAY = 0.7;

const jobsPalette: Palette = (v, out, o) => {
  // Cool teal — distinct from resource ochre. v is jobs road-field magnitude;
  // saturate at JOB_SUPPLY so a single factory's epicentre reads as full.
  const k = Math.max(0, Math.min(1, v / JOB_SUPPLY));
  out[o] = Math.round(40 + 60 * k);
  out[o + 1] = Math.round(110 + 110 * k);
  out[o + 2] = Math.round(140 + 80 * k);
  out[o + 3] = Math.round(220 * k);
};

function createJobsMap(): DemandMap {
  const cellMap = createCellMap(GRID_RES, GRID_RES, CELL_SIZE, WORLD_MIN, WORLD_MIN);
  const roadField = createRoadField();
  // Reach defines which node a building "belongs to" — a few cells past the
  // road sample radius is enough to catch a building set back from the road.
  const NEAREST_RADIUS = CELL_SIZE * 6;
  // How far each hot node bleeds into the cell heatmap.
  const SPLAT_RADIUS = CELL_SIZE * 3;
  return {
    id: 'jobs',
    label: 'jobs',
    kind: 'graph-sourced',
    palette: jobsPalette,
    cellMap,
    roadField,
    recompute(ctx) {
      roadField.clear();
      for (const b of ctx.buildings) {
        if (b.type !== 'factory') continue;
        const node = ctx.graph.nearestNode(b.centroid.x, b.centroid.y, NEAREST_RADIUS);
        if (!node) continue;
        bfsDecay(ctx.graph, node.id, JOB_SUPPLY, JOB_DECAY, roadField);
      }
      for (const b of ctx.buildings) {
        if (b.type !== 'small_house') continue;
        const node = ctx.graph.nearestNode(b.centroid.x, b.centroid.y, NEAREST_RADIUS);
        if (!node) continue;
        roadField.set(node.id, (roadField.get(node.id) ?? 0) - JOB_DEMAND);
      }
      // Drop non-positive entries so consumers don't have to clamp.
      for (const [n, v] of roadField) {
        if (v <= 1e-3) roadField.delete(n);
      }
      splatRoadFieldToCells(roadField, ctx.graph, cellMap, SPLAT_RADIUS);
    },
  };
}

export function createDemandMaps(seed: number): DemandMap[] {
  return [createResourceMap(seed), createJobsMap()];
}
