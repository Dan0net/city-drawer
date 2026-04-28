// 2D ray–shape intersections. All return parametric `t` along (ox,oy)+(dx,dy)
// of the first hit, or Infinity for miss. Origin-inside-shape returns 0.

// Ray vs oriented bbox at (cx,cy), size w×h, rotated by `rot` rad.
export function rayHitOBB(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rot: number,
  maxT: number,
): number {
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const tx = ox - cx;
  const ty = oy - cy;
  const lx = tx * c - ty * s;
  const ly = tx * s + ty * c;
  const ldx = dx * c - dy * s;
  const ldy = dx * s + dy * c;

  const hw = w / 2;
  const hh = h / 2;

  if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return 0;

  let tmin = -Infinity;
  let tmax = Infinity;

  if (Math.abs(ldx) < 1e-9) {
    if (lx < -hw || lx > hw) return Infinity;
  } else {
    const t1 = (-hw - lx) / ldx;
    const t2 = (hw - lx) / ldx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(ldy) < 1e-9) {
    if (ly < -hh || ly > hh) return Infinity;
  } else {
    const t1 = (-hh - ly) / ldy;
    const t2 = (hh - ly) / ldy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return Infinity;
  }

  if (tmin < 0 || tmin > maxT) return Infinity;
  return tmin;
}

// Ray vs closed polygon (flat [x0,y0,x1,y1,...]). Nearest-edge hit, max maxT.
export function rayHitPolygon(
  poly: number[],
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
  let best = maxT;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t = rayHitSegment(
      ox,
      oy,
      dx,
      dy,
      poly[2 * i],
      poly[2 * i + 1],
      poly[2 * j],
      poly[2 * j + 1],
    );
    if (t > 0 && t < best) best = t;
  }
  return best;
}

// Ray vs segment (x0,y0)→(x1,y1). Parallel rays return Infinity.
export function rayHitSegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const ex = x1 - x0;
  const ey = y1 - y0;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-9) return Infinity;
  const inv = 1 / denom;
  const t = ((x0 - ox) * ey - (y0 - oy) * ex) * inv;
  const s = ((x0 - ox) * dy - (y0 - oy) * dx) * inv;
  if (t < 0 || s < 0 || s > 1) return Infinity;
  return t;
}
