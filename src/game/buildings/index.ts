import type { ConsumedFrontage } from '@game/graph';
import type { AABB } from '@lib/aabb';
import type { Vec2 } from '@lib/math';

export type BuildingId = number;
export type FailedAttemptId = number;
export type BuildingType = 'small_house' | 'shop' | 'warehouse' | 'park' | 'factory';

export interface Building {
  id: BuildingId;
  type: BuildingType;
  // Closed polygon in WORLD coords as flat [x0,y0,x1,y1,...]. CCW-ish.
  poly: number[];
  centroid: Vec2;
  aabb: AABB;
  // Sim seconds at spawn. Drives the construction animation in BuildingsLayer.
  spawnedAt: number;
  // Frontage ranges this building occupies (front + any back/side faces along
  // other roads). Restored on removal.
  consumed: ConsumedFrontage[];
  // Slots this building has filled AS A SOURCE for each demand. Read by the
  // demand's BFS broadcast as (def.source.capacity − filled[def.id]). The
  // demand layer manages writes; the building stays a passive record.
  filled?: Record<string, number>;
  // Sources this building filled AS A SINK at spawn. Bulldoze undoes them.
  // The demand is recovered via DEMAND_TYPES.find(d => d.sink.type === type).
  attributedToIds?: BuildingId[];
}

// Rejected spawn attempt. Rendered as a red ghost then pruned. Diagnostic.
export interface FailedAttempt {
  id: FailedAttemptId;
  poly: number[];
  centroid: Vec2;
  aabb: AABB;
  spawnedAt: number;
  reason: string;
}

interface BuildingTypeDef {
  type: BuildingType;
  color: number;
  // Preferred area. Spawner picks the largest size first; on rejection, retries
  // with a smaller targetArea (see SHRINK_FACTORS in spawn.ts).
  targetArea: number;
  // Optional [min, max] range; when present, the spawner samples a target
  // area in this range per spawn instead of using the fixed targetArea.
  targetAreaRange?: [number, number];
  // Acceptable frontage range (meters) along the road tangent.
  frontRange: [number, number];
}

export const BUILDING_TYPES: ReadonlyArray<BuildingTypeDef> = [
  { type: 'small_house', color: 0xc8956a, targetArea: 280, frontRange: [14, 22] },
  { type: 'shop', color: 0x6c97c4, targetArea: 800, frontRange: [24, 36] },
  { type: 'warehouse', color: 0x848c95, targetArea: 1800, frontRange: [36, 54] },
  {
    type: 'park',
    color: 0x6ba070,
    targetArea: 600,
    targetAreaRange: [80, 2400],
    frontRange: [4, 60],
  },
  { type: 'factory', color: 0x8b3e2f, targetArea: 2500, frontRange: [40, 70] },
];

// Smallest frontage any building type will accept. Frontage intervals shorter
// than this can never host a building.
export const MIN_FRONTAGE_LENGTH = Math.min(
  ...BUILDING_TYPES.map((t) => t.frontRange[0]),
);

export const BUILDING_COLORS: Record<BuildingType, number> = (() => {
  const m: Partial<Record<BuildingType, number>> = {};
  for (const t of BUILDING_TYPES) m[t.type] = t.color;
  return m as Record<BuildingType, number>;
})();
