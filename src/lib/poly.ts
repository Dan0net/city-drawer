import type { Vec2 } from './math';
import type { AABB } from './aabb';

// Polygons are flat [x0,y0,x1,y1,...] arrays, closed (last vertex implicitly
// connects to the first), winding sign-agnostic.

export function polyArea(poly: number[]): number {
  let s = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += poly[2 * i] * poly[2 * j + 1] - poly[2 * j] * poly[2 * i + 1];
  }
  return Math.abs(s) * 0.5;
}

export function polyCentroid(poly: number[]): Vec2 {
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
  // Degenerate (zero-area) polygon: fall back to first vertex.
  if (Math.abs(signedArea2) < 1e-9) return { x: poly[0], y: poly[1] };
  const inv = 1 / (3 * signedArea2);
  return { x: cx * inv, y: cy * inv };
}

export function polyAabb(poly: number[]): AABB {
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

// Even-odd ray cast. Robust for concave polys; assumes no self-intersection.
export function pointInPoly(poly: number[], x: number, y: number): boolean {
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

// SAT overlap between a polygon and an oriented bbox (center, length along
// rot, width across rot).
export function polyOverlapsObb(
  poly: number[],
  cx: number,
  cy: number,
  len: number,
  width: number,
  rot: number,
): boolean {
  const tx = Math.cos(rot);
  const ty = Math.sin(rot);
  const nx = -ty;
  const ny = tx;
  const halfLen = len / 2;
  const halfWidth = width / 2;
  const n = poly.length / 2;
  if (n < 3) return false;

  const axes: number[] = [tx, ty, nx, ny];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = poly[2 * j] - poly[2 * i];
    const ey = poly[2 * j + 1] - poly[2 * i + 1];
    const elen = Math.hypot(ex, ey);
    if (elen < 1e-9) continue;
    axes.push(-ey / elen, ex / elen);
  }

  for (let k = 0; k < axes.length; k += 2) {
    const ax = axes[k];
    const ay = axes[k + 1];
    let pmin = Infinity;
    let pmax = -Infinity;
    for (let i = 0; i < n; i++) {
      const proj = poly[2 * i] * ax + poly[2 * i + 1] * ay;
      if (proj < pmin) pmin = proj;
      if (proj > pmax) pmax = proj;
    }
    const ccent = cx * ax + cy * ay;
    const rad =
      halfLen * Math.abs(tx * ax + ty * ay) +
      halfWidth * Math.abs(nx * ax + ny * ay);
    if (pmax < ccent - rad || ccent + rad < pmin) return false;
  }
  return true;
}
