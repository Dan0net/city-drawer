// Cross-cutting sim tunables. Per-type values belong in their table row
// (BUILDING_TYPES, DEMAND_TYPES); only put something here if multiple
// modules genuinely share it.

// Spawn cadence — sim seconds between spawn attempts (uniform sample).
export const SPAWN_INTERVAL_MIN = 0.4;
export const SPAWN_INTERVAL_MAX = 0.8;

const WORLD_SIZE = 5000;
export const WORLD_MIN = -WORLD_SIZE / 2;
export const GRID_RES = 250;
export const CELL_SIZE = WORLD_SIZE / GRID_RES;

// Disc radius around each road node when integrating cell values into the
// road field (cell-sourced demands).
export const CELL_SAMPLE_RADIUS = CELL_SIZE * 3;
// Radius used when splatting a node-field back onto cells for visualization.
export const FIELD_SPLAT_RADIUS = CELL_SIZE * 6;

// Spawn picker exponents. Two-stage roulette: first pick a demand weighted by
// global avail^EXP_DEMAND, then pick an edge weighted by field^EXP_LOCATION.
// Higher → sharper preference for high-availability / high-field choices.
export const EXP_DEMAND = 2;
export const EXP_LOCATION = 1;
