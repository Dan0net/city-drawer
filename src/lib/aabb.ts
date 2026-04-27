import type { Vec2 } from './math';

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const aabb = (minX: number, minY: number, maxX: number, maxY: number): AABB => ({
  minX,
  minY,
  maxX,
  maxY,
});

export const aabbContains = (b: AABB, p: Vec2): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

export const aabbIntersects = (a: AABB, b: AABB): boolean =>
  !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
