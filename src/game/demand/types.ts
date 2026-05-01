import type { BuildingType } from '@game/buildings';

export type DemandId = 'resource' | 'jobs' | 'commercial' | 'leisure';

// (value, sat) → [r,g,b,a] in 0..255. Allocation-free; renderer writes into
// `out` at `offset`. `sat` is the value at which the ramp fully saturates
// (typically max field for building-sourced, 1 for cell-sourced).
export type Palette = (v: number, sat: number, out: Uint8Array, offset: number) => void;

// SOURCE: where the demand comes from. `cells` reads a noise-seeded grid; a
// building source broadcasts (capacity − slotsGivenBy(ledger, b.id)) along
// the road graph.
type DemandSource =
  | { kind: 'cells' }
  | { kind: 'building'; type: BuildingType; capacity: number };

// SINK: a building type that, when placed, claims slots from nearby sources
// closest-first via BFS. A building type sinks at most one demand (KISS); it
// can SOURCE any number.
interface DemandSink {
  type: BuildingType;
  // Multiplier on per-sink slot demand. Default 1.
  consumption?: number;
}

export interface DemandDef {
  id: DemandId;
  label: string;
  source: DemandSource;
  sink: DemandSink;
  decay: number;
  // Divisor that converts a sink's area to integer slot demand. A
  // default-sized sink consumes ≈ 1 slot. Undefined → use raw area.
  unitArea?: number;
  palette: Palette;
  // Render-only: flip the hover arrow so it points sink→source visually.
  // Used for jobs so the arrow points at the workplace, not the worker.
  flipArrow?: boolean;
}

const resourcePalette: Palette = (v, sat, out, o) => {
  const k = Math.max(0, Math.min(1, v / sat));
  out[o] = Math.round(120 + 135 * k);
  out[o + 1] = Math.round(70 + 90 * k);
  out[o + 2] = Math.round(20 + 30 * k);
  out[o + 3] = Math.round(220 * k);
};

const ramp = (r0: number, r1: number, g0: number, g1: number, b0: number, b1: number): Palette =>
  (v, sat, out, o) => {
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
    sink: { type: 'factory', consumption: 3 },
    decay: 0,
    unitArea: 2500,
    palette: resourcePalette,
  },
  {
    id: 'jobs',
    label: 'jobs',
    source: { kind: 'building', type: 'factory', capacity: 16 },
    sink: { type: 'small_house' },
    decay: 0.7,
    unitArea: 280,
    palette: ramp(40, 60, 110, 110, 140, 80),
    flipArrow: true,
  },
  {
    id: 'commercial',
    label: 'commercial',
    source: { kind: 'building', type: 'small_house', capacity: 1 },
    sink: { type: 'shop' },
    decay: SERVICE_DECAY,
    unitArea: 80,
    palette: ramp(60, 60, 60, 80, 140, 100),
  },
  {
    id: 'leisure',
    label: 'leisure',
    source: { kind: 'building', type: 'small_house', capacity: 1 },
    sink: { type: 'park' },
    decay: SERVICE_DECAY,
    unitArea: 30,
    palette: ramp(60, 70, 120, 80, 70, 60),
  },
];
