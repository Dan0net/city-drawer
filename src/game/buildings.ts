import type { ConsumedFrontage } from './graph';
import type { AABB } from '@lib/aabb';
import type { Vec2 } from '@lib/math';

export type BuildingId = number;
export type FailedAttemptId = number;
export type BuildingType = 'small_house' | 'shop' | 'warehouse' | 'park';

export interface Building {
  id: BuildingId;
  type: BuildingType;
  // Closed polygon in WORLD coords as flat [x0,y0,x1,y1,...].
  // CCW-ish; renderer treats it as a closed loop.
  poly: number[];
  centroid: Vec2;
  aabb: AABB;
  // Sim seconds at spawn. Drives the construction animation in BuildingsLayer.
  spawnedAt: number;
  // Frontage ranges this building occupies (front + any back/side faces along
  // other roads). Restored on removal.
  consumed: ConsumedFrontage[];
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
  weight: number;
  color: number;
  // Preferred area. Spawner picks the largest size first; on rejection, retries
  // with a smaller targetArea (see SHRINK_FACTORS in spawn.ts).
  targetArea: number;
  // Optional [min, max] range; when present, the spawner samples a target
  // area in this range per spawn instead of using the fixed targetArea.
  // Used by parks, which have wildly variable sizes.
  targetAreaRange?: [number, number];
  // Acceptable frontage range (meters) along the road tangent.
  frontRange: [number, number];
}

export const BUILDING_TYPES: ReadonlyArray<BuildingTypeDef> = [
  {
    type: 'small_house',
    weight: 0.55,
    color: 0xc8956a,
    targetArea: 280,
    frontRange: [14, 22],
  },
  {
    type: 'shop',
    weight: 0.3,
    color: 0x6c97c4,
    targetArea: 800,
    frontRange: [24, 36],
  },
  {
    type: 'warehouse',
    weight: 0.15,
    color: 0x848c95,
    targetArea: 1800,
    frontRange: [36, 54],
  },
  {
    type: 'park',
    weight: 0.10,
    color: 0x6ba070,
    // Median used only as a fallback; per-spawn area is sampled from range.
    targetArea: 600,
    targetAreaRange: [80, 2400],
    frontRange: [4, 60],
  },
];

// Smallest frontage any building type will accept. Frontage intervals shorter
// than this can never host a building, so they're filtered out of pickFrontage
// and the green debug overlay.
export const MIN_FRONTAGE_LENGTH = Math.min(
  ...BUILDING_TYPES.map((t) => t.frontRange[0]),
);

export const BUILDING_COLORS: Record<BuildingType, number> = (() => {
  const m: Partial<Record<BuildingType, number>> = {};
  for (const t of BUILDING_TYPES) m[t.type] = t.color;
  return m as Record<BuildingType, number>;
})();

