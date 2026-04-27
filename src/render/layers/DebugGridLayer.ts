import { Container, Graphics } from 'pixi.js';
import type { Viewport } from '@render/pixi/Viewport';
import { useCameraStore } from '@game/store/cameraStore';

// Adaptive two-level grid: pick a "fine" step where fine*zoom is roughly
// MIN_STEP_PX on screen, and a "coarse" step = fine * 10. Only draws lines
// within the visible viewport so cost is bounded by screen area, not world size.
const MIN_STEP_PX = 16;
const FINE_COLOR = 0x1c2330;
const COARSE_COLOR = 0x2a3445;
const AXIS_COLOR = 0x4a5d7a;

export class DebugGridLayer {
  readonly container = new Container();
  private g = new Graphics();

  constructor(private readonly viewport: Viewport) {
    this.container.label = 'debug-grid';
    this.container.addChild(this.g);
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  // Call once per frame.
  update(): void {
    const zoom = useCameraStore.getState().zoom;
    const fine = Math.pow(10, Math.max(0, Math.ceil(Math.log10(MIN_STEP_PX / zoom))));
    const coarse = fine * 10;
    const bounds = this.viewport.visibleBounds();
    // Inflate by one coarse step so partially-visible lines aren't clipped.
    const minX = Math.floor(bounds.minX / coarse) * coarse - coarse;
    const minY = Math.floor(bounds.minY / coarse) * coarse - coarse;
    const maxX = Math.ceil(bounds.maxX / coarse) * coarse + coarse;
    const maxY = Math.ceil(bounds.maxY / coarse) * coarse + coarse;

    const fineWidth = 1 / zoom;
    const coarseWidth = 1.5 / zoom;
    const axisWidth = 2 / zoom;

    const g = this.g;
    g.clear();

    // Fine vertical lines
    for (let x = minX; x <= maxX; x += fine) {
      if (Math.abs(x % coarse) < fine * 0.5) continue; // skip coarse positions
      g.moveTo(x, minY).lineTo(x, maxY);
    }
    g.stroke({ width: fineWidth, color: FINE_COLOR, alpha: 1 });

    // Fine horizontal lines
    for (let y = minY; y <= maxY; y += fine) {
      if (Math.abs(y % coarse) < fine * 0.5) continue;
      g.moveTo(minX, y).lineTo(maxX, y);
    }
    g.stroke({ width: fineWidth, color: FINE_COLOR, alpha: 1 });

    // Coarse vertical
    for (let x = minX; x <= maxX; x += coarse) {
      if (x === 0) continue;
      g.moveTo(x, minY).lineTo(x, maxY);
    }
    g.stroke({ width: coarseWidth, color: COARSE_COLOR, alpha: 1 });

    // Coarse horizontal
    for (let y = minY; y <= maxY; y += coarse) {
      if (y === 0) continue;
      g.moveTo(minX, y).lineTo(maxX, y);
    }
    g.stroke({ width: coarseWidth, color: COARSE_COLOR, alpha: 1 });

    // Axes through origin
    g.moveTo(minX, 0).lineTo(maxX, 0);
    g.stroke({ width: axisWidth, color: AXIS_COLOR, alpha: 1 });
    g.moveTo(0, minY).lineTo(0, maxY);
    g.stroke({ width: axisWidth, color: AXIS_COLOR, alpha: 1 });
  }
}
