// Cross-cutting sim tunables. Per-type values belong in their table row
// (BUILDING_TYPES, DEMAND_TYPES); only put something here if multiple
// modules genuinely share it.

// Spawn cadence — sim seconds between spawn attempts (uniform sample).
export const SPAWN_INTERVAL_MIN = 0.4;
export const SPAWN_INTERVAL_MAX = 0.8;

// World grid for cell-sourced demand maps. 4096 m world, ~16 m/cell.
const WORLD_SIZE = 4096;
export const WORLD_MIN = -WORLD_SIZE / 2;
export const GRID_RES = 256;
export const CELL_SIZE = WORLD_SIZE / GRID_RES;

// Disc radius around each road node when integrating cell values into the
// road field (cell-sourced demands).
export const CELL_SAMPLE_RADIUS = CELL_SIZE * 3;
// Radius from a building centroid to find its road-graph anchor node when
// broadcasting (building-sourced demands).
export const SOURCE_ANCHOR_RADIUS = CELL_SIZE * 6;
// Radius used when splatting a node-field back onto cells for visualization.
export const FIELD_SPLAT_RADIUS = CELL_SIZE * 3;

// Sink → source attribution: starting graph-distance radius when locating
// sources to fill. Used by both the attribution step and the pre-spawn
// nearest-source lookup.
export const ATTRIBUTION_NEAREST_RADIUS = 96;
