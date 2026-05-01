// Uniform world-aligned scalar grid. The world spans
// [originX, originX + cols*cellSize) × [originY, originY + rows*cellSize).
export interface CellMap {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly originX: number;
  readonly originY: number;
  readonly data: Float32Array;
}

export function createCellMap(
  cols: number,
  rows: number,
  cellSize: number,
  originX: number,
  originY: number,
): CellMap {
  return { cols, rows, cellSize, originX, originY, data: new Float32Array(cols * rows) };
}

// Iterate every cell whose center falls within `radius` of (x, y).
// Visits each cell at most once. `fn` receives cell value, distance, and indices.
export function forEachCellInRadius(
  map: CellMap,
  x: number,
  y: number,
  radius: number,
  fn: (value: number, dist: number, i: number, j: number) => void,
): void {
  const r2 = radius * radius;
  const i0 = Math.max(0, Math.floor((x - radius - map.originX) / map.cellSize));
  const i1 = Math.min(map.cols - 1, Math.floor((x + radius - map.originX) / map.cellSize));
  const j0 = Math.max(0, Math.floor((y - radius - map.originY) / map.cellSize));
  const j1 = Math.min(map.rows - 1, Math.floor((y + radius - map.originY) / map.cellSize));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const cx = map.originX + (i + 0.5) * map.cellSize;
      const cy = map.originY + (j + 0.5) * map.cellSize;
      const dx = cx - x;
      const dy = cy - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      fn(map.data[j * map.cols + i], Math.sqrt(d2), i, j);
    }
  }
}

