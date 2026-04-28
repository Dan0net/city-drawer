import type { NodeId } from '@game/graph';

// Per-node scalar field. Values stored only where non-zero so iteration is cheap.
// Edge tinting interpolates between endpoints.
export type RoadField = Map<NodeId, number>;

export const createRoadField = (): RoadField => new Map();
