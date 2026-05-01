import type { BuildingType } from '@game/buildings';

type DemandId = 'resource' | 'jobs' | 'commercial' | 'leisure';

// 0..1 → [r,g,b,a] in 0..255. Allocation-free; renderer writes into `out` at `offset`.
export type Palette = (v: number, out: Uint8Array, offset: number) => void;

// SOURCE: where the demand comes from. `cells` reads a noise-seeded grid; a
// building source broadcasts (capacity - filled[id]) along the road graph.
type DemandSource =
  | { kind: 'cells' }
  | { kind: 'building'; type: BuildingType; capacity: number };

// SINK: a building type that, when placed, fills `count` source slots near it.
// A building type sinks at most one demand (KISS); it can SOURCE any number.
interface DemandSink {
  type: BuildingType;
  count: number;
}

export interface DemandDef {
  id: DemandId;
  label: string;
  source: DemandSource;
  sink: DemandSink;
  // BFS decay per hop for building-sourced maps; ignored for cell-sourced.
  decay: number;
  // Cell-sourced only: how much of `cap` (= Σ roadField) one sink consumes.
  // Default 1 → cap is denominated in factory-equivalents. Ignored for
  // building-sourced (filled is computed from source.filled[id]).
  consumption?: number;
  palette: Palette;
}

const resourcePalette: Palette = (v, out, o) => {
  const k = Math.max(0, Math.min(1, v));
  out[o] = Math.round(120 + 135 * k);
  out[o + 1] = Math.round(70 + 90 * k);
  out[o + 2] = Math.round(20 + 30 * k);
  out[o + 3] = Math.round(220 * k);
};

// Palette saturation for a building-sourced field. Many sources sum BFS
// contributions, so the natural cap is roughly capacity × 1/(1−decay). We
// pass that in as `sat` so each demand's palette saturates appropriately.
const ramp = (r0: number, r1: number, g0: number, g1: number, b0: number, b1: number, sat: number): Palette =>
  (v, out, o) => {
    const k = Math.max(0, Math.min(1, v / sat));
    out[o] = Math.round(r0 + r1 * k);
    out[o + 1] = Math.round(g0 + g1 * k);
    out[o + 2] = Math.round(b0 + b1 * k);
    out[o + 3] = Math.round(220 * k);
  };

const SERVICE_DECAY = 0.7;

export const DEMAND_TYPES: ReadonlyArray<DemandDef> = [
  {
    id: 'resource',
    label: 'resource',
    source: { kind: 'cells' },
    sink: { type: 'factory', count: 0 },
    decay: 0,
    consumption: 1,
    palette: resourcePalette,
  },
  {
    id: 'jobs',
    label: 'jobs',
    source: { kind: 'building', type: 'factory', capacity: 8 },
    sink: { type: 'small_house', count: 1 },
    decay: 0.7,
    palette: ramp(40, 60, 110, 110, 140, 80, /* sat = one full factory */ 8),
  },
  {
    id: 'commercial',
    label: 'commercial',
    source: { kind: 'building', type: 'small_house', capacity: 1 },
    sink: { type: 'shop', count: 10 },
    decay: SERVICE_DECAY,
    palette: ramp(60, 60, 60, 80, 140, 100, 10),
  },
  {
    id: 'leisure',
    label: 'leisure',
    source: { kind: 'building', type: 'small_house', capacity: 1 },
    sink: { type: 'park', count: 20 },
    decay: SERVICE_DECAY,
    palette: ramp(60, 70, 120, 80, 70, 60, 20),
  },
];
