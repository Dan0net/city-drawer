import type { Application, Texture } from 'pixi.js';
import { Graphics } from 'pixi.js';
import type { BuildingType } from '@game/buildings';

// Pre-baked per-type texture: white interior + a stylized darker pattern + dark
// outline. The whole texture is white-biased so per-building runtime tint
// (lerping grey → type color across `progress`) controls the apparent color;
// the outline is dark so tint produces a darkened version of whatever the
// building's current tint is, reading as a natural outline at every progress
// stage.

export const TEXTURE_SIZE = 64;
const OUTLINE_WIDTH = 3;
const OUTLINE_COLOR = 0x202428;
const FILL = 0xffffff;
const PATTERN = 0xdadcde;

export function bakeBuildingTextures(app: Application): Record<BuildingType, Texture> {
  return {
    small_house: bake(app, drawHouse),
    shop: bake(app, drawShop),
    warehouse: bake(app, drawWarehouse),
  };
}

function bake(app: Application, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  // resolution 2 keeps the pattern crisp at close zoom on HiDPI.
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

function drawBase(g: Graphics): void {
  g.rect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE).fill({ color: FILL, alpha: 1 });
}

function drawOutline(g: Graphics): void {
  const w = OUTLINE_WIDTH;
  // Inset by half the stroke width so the stroke fits inside the texture frame.
  g.rect(w / 2, w / 2, TEXTURE_SIZE - w, TEXTURE_SIZE - w).stroke({
    width: w,
    color: OUTLINE_COLOR,
    alpha: 1,
  });
}

function drawHouse(g: Graphics): void {
  drawBase(g);
  // Checkerboard of small squares (4×4).
  const cells = 4;
  const cs = TEXTURE_SIZE / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if ((i + j) % 2 !== 0) continue;
      g.rect(i * cs, j * cs, cs, cs).fill({ color: PATTERN, alpha: 0.6 });
    }
  }
  drawOutline(g);
}

function drawShop(g: Graphics): void {
  drawBase(g);
  // Vertical stripes.
  const stripes = 8;
  const sw = TEXTURE_SIZE / stripes;
  for (let i = 0; i < stripes; i += 2) {
    g.rect(i * sw, 0, sw, TEXTURE_SIZE).fill({ color: PATTERN, alpha: 0.6 });
  }
  drawOutline(g);
}

function drawWarehouse(g: Graphics): void {
  drawBase(g);
  // 2×2 inset blocks for an industrial feel.
  const cells = 2;
  const cs = TEXTURE_SIZE / cells;
  const m = 4;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      g.rect(i * cs + m, j * cs + m, cs - m * 2, cs - m * 2).fill({
        color: PATTERN,
        alpha: 0.5,
      });
    }
  }
  drawOutline(g);
}
