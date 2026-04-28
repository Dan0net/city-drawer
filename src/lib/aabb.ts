export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const aabbContainsPoint = (a: AABB, x: number, y: number): boolean =>
  x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY;
