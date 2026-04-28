// FastNoiseLite is shipped as untyped JS; declare just what we use.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - no types
import FastNoiseLite from 'fastnoise-lite';
import type { CellMap } from './cellMap';

// Fill `map.data` with thresholded low-frequency simplex noise so the world
// gets one or two distinct hot blobs of resource. Deterministic in `seed`.
export function seedResourceBlobs(map: CellMap, seed: number): void {
  // Wavelength ~2000m → about two blobs across a 4096m world.
  const noise = new FastNoiseLite();
  noise.SetSeed(seed);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
  noise.SetFrequency(0.0008);

  // Threshold below which a cell is empty; remaining range remaps to [0..1].
  const cutoff = 0.25;
  const range = 1 - cutoff;

  for (let j = 0; j < map.rows; j++) {
    for (let i = 0; i < map.cols; i++) {
      const wx = map.originX + (i + 0.5) * map.cellSize;
      const wy = map.originY + (j + 0.5) * map.cellSize;
      const n = noise.GetNoise(wx, wy); // [-1..1]
      const v = n > cutoff ? (n - cutoff) / range : 0;
      map.data[j * map.cols + i] = v;
    }
  }
}
