// Sim-published timing contract for spawn/failure animation. Sim uses these
// to know when a failed-attempt visualization has finished and can be pruned;
// the renderer uses the same numbers so its animation matches the prune.
// Single source of truth — both sides import here, neither defines its own.

// Per-edge stroke draw time during the perimeter animation.
export const PERIMETER_EDGE_DURATION_S = 0.2;
// Fill fade-in time after the perimeter completes (confirmed buildings).
export const FILL_DURATION_S = 0.4;
// Hold time after the failed-attempt perimeter completes, before pruning.
const FAILED_HOLD_AFTER_PERIMETER_S = 1.2;

// Total visualization lifetime for a failed attempt with `numEdges` edges.
export const failedAttemptLifetime = (numEdges: number): number =>
  numEdges * PERIMETER_EDGE_DURATION_S + FAILED_HOLD_AFTER_PERIMETER_S;
