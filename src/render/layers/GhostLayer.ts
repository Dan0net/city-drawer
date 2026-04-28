import { Container, Graphics } from 'pixi.js';
import { useWorldStore } from '@game/store/worldStore';
import { useCameraStore } from '@game/store/cameraStore';

const ROAD_WIDTH = 8;
const SMALL_ROAD_WIDTH = 4;
const PATH_WIDTH = 2;
const GHOST_COLOR = 0x4a90ff;
const SNAP_NODE_COLOR = 0x6cf08a;
const SNAP_EDGE_COLOR = 0xffd060;

// Drawing preview + snap markers. Redrawn every frame; cheap because it's tiny.
export class GhostLayer {
  readonly container = new Container();
  private g = new Graphics();

  constructor() {
    this.container.label = 'ghost';
    this.container.addChild(this.g);
  }

  update(): void {
    const { tool, drawingStart, snap, pointerWorld, drawingCrossings } =
      useWorldStore.getState();
    const { zoom } = useCameraStore.getState();
    const g = this.g;
    g.clear();
    if (!pointerWorld) return;
    if (tool !== 'road' && tool !== 'small_road' && tool !== 'path') return;

    const width =
      tool === 'road' ? ROAD_WIDTH : tool === 'small_road' ? SMALL_ROAD_WIDTH : PATH_WIDTH;

    if (drawingStart && snap) {
      g.moveTo(drawingStart.x, drawingStart.y).lineTo(snap.x, snap.y);
      g.stroke({ width, color: GHOST_COLOR, alpha: 0.55, cap: 'round' });
    }

    // Crossings — preview where new nodes will appear when the line commits.
    if (drawingStart && drawingCrossings.length > 0) {
      const r = 5 / zoom;
      const strokeW = 1.5 / zoom;
      for (const c of drawingCrossings) {
        g.circle(c.x, c.y, r).fill({ color: SNAP_NODE_COLOR, alpha: 0.85 });
        g.circle(c.x, c.y, r).stroke({ width: strokeW, color: 0x0b0e13, alpha: 0.9 });
      }
    }

    // Snap marker — sized in screen pixels via 1/zoom.
    const ringR = 8 / zoom;
    const ringW = 2 / zoom;
    const dotR = 5 / zoom;
    if (snap) {
      if (snap.kind === 'node') {
        g.circle(snap.x, snap.y, ringR).stroke({ width: ringW, color: SNAP_NODE_COLOR, alpha: 1 });
      } else if (snap.kind === 'edge') {
        g.circle(snap.x, snap.y, dotR).fill({ color: SNAP_EDGE_COLOR, alpha: 0.95 });
      } else {
        // 'free' — preview the road as a 0-length stroke (filled circle of
        // road width) plus the node dot the click would create.
        g.circle(snap.x, snap.y, width / 2).fill({ color: GHOST_COLOR, alpha: 0.55 });
        g.circle(snap.x, snap.y, dotR).fill({ color: SNAP_NODE_COLOR, alpha: 0.85 });
      }
    }

    if (drawingStart) {
      g.circle(drawingStart.x, drawingStart.y, dotR).fill({
        color: SNAP_NODE_COLOR,
        alpha: 0.85,
      });
    }
  }
}
