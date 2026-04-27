export type BuildingId = number;
export type FailedAttemptId = number;
export type BuildingType = 'small_house' | 'shop' | 'warehouse';

export interface BuildingAabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Building {
  id: BuildingId;
  type: BuildingType;
  // Closed polygon in WORLD coords as a flat list [x0,y0,x1,y1,...].
  // Vertices are CCW-ish (dictated by the spawn algorithm); the renderer treats
  // them as a closed loop, the last vertex implicitly connects back to the first.
  poly: number[];
  centroid: { x: number; y: number };
  aabb: BuildingAabb;
  // Sim seconds at spawn. Drives the construction animation in BuildingsLayer.
  spawnedAt: number;
}

// A spawn attempt that didn't pass validation. Rendered as a red ghost outline
// using the same construction animation as a real building, then auto-pruned.
// Useful for diagnosing why the spawner is rejecting candidates.
export interface FailedAttempt {
  id: FailedAttemptId;
  poly: number[];
  centroid: { x: number; y: number };
  aabb: BuildingAabb;
  spawnedAt: number;
  reason: string;
}

export interface BuildingTypeDef {
  type: BuildingType;
  weight: number;
  color: number;
  // Preferred area. Spawner picks the largest size first; on rejection, retries
  // with a smaller targetArea (see SHRINK_FACTORS in spawn.ts).
  targetArea: number;
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
];

export const BUILDING_COLORS: Record<BuildingType, number> = (() => {
  const m: Partial<Record<BuildingType, number>> = {};
  for (const t of BUILDING_TYPES) m[t.type] = t.color;
  return m as Record<BuildingType, number>;
})();

// ---------- polygon helpers ----------

export function polyArea(poly: number[]): number {
  let s = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += poly[2 * i] * poly[2 * j + 1] - poly[2 * j] * poly[2 * i + 1];
  }
  return Math.abs(s) * 0.5;
}

export function polyCentroid(poly: number[]): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  let signedArea2 = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = poly[2 * i];
    const y0 = poly[2 * i + 1];
    const x1 = poly[2 * j];
    const y1 = poly[2 * j + 1];
    const cross = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
    signedArea2 += cross;
  }
  if (Math.abs(signedArea2) < 1e-9) return { x: poly[0], y: poly[1] };
  const inv = 1 / (3 * signedArea2);
  return { x: cx * inv, y: cy * inv };
}

export function polyAabb(poly: number[]): BuildingAabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    const x = poly[i];
    const y = poly[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function aabbContainsPoint(a: BuildingAabb, x: number, y: number): boolean {
  return x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY;
}

export function pointInPoly(poly: number[], x: number, y: number): boolean {
  // Even-odd ray-cast. Robust to concave polygons and self-touching boundaries
  // we won't be producing here.
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i];
    const yi = poly[2 * i + 1];
    const xj = poly[2 * j];
    const yj = poly[2 * j + 1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
