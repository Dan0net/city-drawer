// Auto-split a straight road being drawn into ~100m segments. Returns the
// intermediate points along [start..end] (exclusive of endpoints). Empty when
// the line is short enough to leave alone.
const TARGET_LEN = 100;

interface SubdivisionPoint {
  x: number;
  y: number;
  t: number; // along start → end, in (0, 1)
}

export function subdivideStraight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): SubdivisionPoint[] {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  // round() picks the divisor that keeps every segment within [50, 150] for
  // any len ≥ 50: e.g. 149 → 1 seg of 149; 151 → 2 segs of 75.5; 300 → 3 segs.
  const n = Math.max(1, Math.round(len / TARGET_LEN));
  if (n === 1) return [];
  const out: SubdivisionPoint[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    out.push({ x: ax + dx * t, y: ay + dy * t, t });
  }
  return out;
}
