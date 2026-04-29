import type { Graph } from '@game/graph';
import type { Building } from '@game/buildings';
import { HOUSE_COMMERCIAL_TOTAL, HOUSE_LEISURE_TOTAL, JOBS_PER_FACTORY } from '@game/buildings';
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

// Jobs road-field broadcasts each factory's remaining (unfilled) job count
// along the graph, decaying per hop. Houses fill jobs by incrementing their
// attributed factory's `jobsFilled` (worldStore), so consumption is real
// state, not a subtraction at recompute time. When a factory is full, its
// contribution is 0 and the field cools naturally.
const JOB_DECAY = 0.7;

const jobsPalette: Palette = (v, out, o) => {
  // Cool teal — distinct from resource ochre. Saturate at one full factory's
  // worth of jobs so a brand-new fully-staffed factory reads as full colour.
  const k = Math.max(0, Math.min(1, v / JOBS_PER_FACTORY));
  out[o] = Math.round(40 + 60 * k);
  out[o + 1] = Math.round(110 + 110 * k);
  out[o + 2] = Math.round(140 + 80 * k);
  out[o + 3] = Math.round(220 * k);
};

function createJobsMap(): DemandMap {
  const cellMap = createCellMap(GRID_RES, GRID_RES, CELL_SIZE, WORLD_MIN, WORLD_MIN);
  const roadField = createRoadField();
  const NEAREST_RADIUS = CELL_SIZE * 6;
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
        const remaining = (b.jobsTotal ?? 0) - (b.jobsFilled ?? 0);
        if (remaining <= 0) continue;
        const node = ctx.graph.nearestNode(b.centroid.x, b.centroid.y, NEAREST_RADIUS);
        if (!node) continue;
        bfsDecay(ctx.graph, node.id, remaining, JOB_DECAY, roadField);
      }
      splatRoadFieldToCells(roadField, ctx.graph, cellMap, SPLAT_RADIUS);
    },
  };
}

// Commercial / leisure: each house broadcasts (TOTAL - filled) along the
// graph with decay, the same way factories do for jobs. Shops consume
// commercial slots, parks consume leisure slots.
const SERVICE_DECAY = 0.7;

// Service road-fields sum BFS contributions from many house sources, so the
// natural cap at any node is 1/(1-decay) ≈ 3.3 with decay 0.7 — much higher
// than a single source's value. Use that cap as the palette saturation
// point so a typical cluster reads as partial colour, matching jobs.
const SERVICE_PALETTE_SATURATION = 1 / (1 - SERVICE_DECAY);

const commercialPalette: Palette = (v, out, o) => {
  // Indigo — distinct from teal jobs and ochre resource.
  const k = Math.max(0, Math.min(1, v / SERVICE_PALETTE_SATURATION));
  out[o] = Math.round(60 + 60 * k);
  out[o + 1] = Math.round(60 + 80 * k);
  out[o + 2] = Math.round(140 + 100 * k);
  out[o + 3] = Math.round(220 * k);
};

const leisurePalette: Palette = (v, out, o) => {
  // Mossy green — distinct from the other three.
  const k = Math.max(0, Math.min(1, v / SERVICE_PALETTE_SATURATION));
  out[o] = Math.round(60 + 70 * k);
  out[o + 1] = Math.round(120 + 80 * k);
  out[o + 2] = Math.round(70 + 60 * k);
  out[o + 3] = Math.round(220 * k);
};

function createServiceDemandMap(
  id: string,
  label: string,
  palette: Palette,
  totalPerHouse: number,
  filledOf: (b: { commercialFilled?: number; leisureFilled?: number }) => number,
): DemandMap {
  const cellMap = createCellMap(GRID_RES, GRID_RES, CELL_SIZE, WORLD_MIN, WORLD_MIN);
  const roadField = createRoadField();
  const NEAREST_RADIUS = CELL_SIZE * 6;
  const SPLAT_RADIUS = CELL_SIZE * 3;
  return {
    id,
    label,
    kind: 'graph-sourced',
    palette,
    cellMap,
    roadField,
    recompute(ctx) {
      roadField.clear();
      for (const b of ctx.buildings) {
        if (b.type !== 'small_house') continue;
        const remaining = totalPerHouse - filledOf(b);
        if (remaining <= 0) continue;
        const node = ctx.graph.nearestNode(b.centroid.x, b.centroid.y, NEAREST_RADIUS);
        if (!node) continue;
        bfsDecay(ctx.graph, node.id, remaining, SERVICE_DECAY, roadField);
      }
      splatRoadFieldToCells(roadField, ctx.graph, cellMap, SPLAT_RADIUS);
    },
  };
}

export function createDemandMaps(seed: number): DemandMap[] {
  return [
    createResourceMap(seed),
    createJobsMap(),
    createServiceDemandMap(
      'commercial',
      'commercial',
      commercialPalette,
      HOUSE_COMMERCIAL_TOTAL,
      (b) => b.commercialFilled ?? 0,
    ),
    createServiceDemandMap(
      'leisure',
      'leisure',
      leisurePalette,
      HOUSE_LEISURE_TOTAL,
      (b) => b.leisureFilled ?? 0,
    ),
  ];
}
