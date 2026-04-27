export type BuildingId = number;
export type BuildingType = 'small_house' | 'shop' | 'warehouse';

export interface Building {
  id: BuildingId;
  type: BuildingType;
  cx: number;
  cy: number;
  // Footprint dimensions: w along its local x-axis (along-edge), h along local y (depth from edge).
  w: number;
  h: number;
  rot: number;
  // 0..1; Stage 3 will lerp this from 0 to 1 over `developMs`. v0 spawns fully built.
  progress: number;
  spawnedAt: number;
}

// One unit = 8 m. Sizes below are in (along-edge units, depth units).
export const UNIT = 16;

export interface BuildingTypeDef {
  type: BuildingType;
  weight: number;
  // Largest first; spawner shrinks until it fits.
  sizes: ReadonlyArray<readonly [number, number]>;
  color: number;
}

export const BUILDING_TYPES: ReadonlyArray<BuildingTypeDef> = [
  {
    type: 'small_house',
    weight: 0.55,
    sizes: [
      [2, 1],
      [1, 1],
    ],
    color: 0xc8956a,
  },
  {
    type: 'shop',
    weight: 0.3,
    sizes: [
      [3, 2],
      [2, 2],
    ],
    color: 0x6c97c4,
  },
  {
    type: 'warehouse',
    weight: 0.15,
    sizes: [
      [4, 4],
      [3, 3],
    ],
    color: 0x848c95,
  },
];

export const BUILDING_COLORS: Record<BuildingType, number> = (() => {
  const m: Partial<Record<BuildingType, number>> = {};
  for (const t of BUILDING_TYPES) m[t.type] = t.color;
  return m as Record<BuildingType, number>;
})();

// ----- OBB helpers -----

export interface Obb {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

// Returns [x0,y0, x1,y1, x2,y2, x3,y3] in CCW order.
export function obbCorners(b: Obb): number[] {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const hw = b.w / 2;
  const hh = b.h / 2;
  return [
    b.cx + -hw * c - -hh * s,
    b.cy + -hw * s + -hh * c,
    b.cx + hw * c - -hh * s,
    b.cy + hw * s + -hh * c,
    b.cx + hw * c - hh * s,
    b.cy + hw * s + hh * c,
    b.cx + -hw * c - hh * s,
    b.cy + -hw * s + hh * c,
  ];
}

export function obbAabb(b: Obb): { minX: number; minY: number; maxX: number; maxY: number } {
  const cs = obbCorners(b);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    if (cs[i] < minX) minX = cs[i];
    if (cs[i] > maxX) maxX = cs[i];
    if (cs[i + 1] < minY) minY = cs[i + 1];
    if (cs[i + 1] > maxY) maxY = cs[i + 1];
  }
  return { minX, minY, maxX, maxY };
}

// SAT overlap of two OBBs. Includes a fast AABB reject.
export function obbOverlap(a: Obb, b: Obb): boolean {
  const aA = obbAabb(a);
  const aB = obbAabb(b);
  if (aA.maxX < aB.minX || aB.maxX < aA.minX) return false;
  if (aA.maxY < aB.minY || aB.maxY < aA.minY) return false;

  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const ax = Math.cos(a.rot);
  const ay = Math.sin(a.rot);
  const bx = Math.cos(b.rot);
  const by = Math.sin(b.rot);
  const axes: ReadonlyArray<readonly [number, number]> = [
    [ax, ay],
    [-ay, ax],
    [bx, by],
    [-by, bx],
  ];
  for (const ax2 of axes) {
    let aMin = Infinity;
    let aMax = -Infinity;
    let bMin = Infinity;
    let bMax = -Infinity;
    for (let i = 0; i < 8; i += 2) {
      const pa = ca[i] * ax2[0] + ca[i + 1] * ax2[1];
      const pb = cb[i] * ax2[0] + cb[i + 1] * ax2[1];
      if (pa < aMin) aMin = pa;
      if (pa > aMax) aMax = pa;
      if (pb < bMin) bMin = pb;
      if (pb > bMax) bMax = pb;
    }
    if (aMax < bMin || bMax < aMin) return false;
  }
  return true;
}

export function obbContainsPoint(b: Obb, x: number, y: number): boolean {
  const dx = x - b.cx;
  const dy = y - b.cy;
  const c = Math.cos(-b.rot);
  const s = Math.sin(-b.rot);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}
