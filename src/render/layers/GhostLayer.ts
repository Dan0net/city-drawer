import { Container, Graphics } from 'pixi.js';
import { useWorldStore } from '@game/store/worldStore';
import { useCameraStore } from '@game/store/cameraStore';

const ROAD_WIDTH = 6;
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
    const { tool, drawingStart, snap, pointerWorld } = useWorldStore.getState();
    const { zoom } = useCameraStore.getState();
    const g = this.g;
    g.clear();
    if (!pointerWorld) return;
    if (tool !== 'road' && tool !== 'path') return;

    const width = tool === 'road' ? ROAD_WIDTH : PATH_WIDTH;

    if (drawingStart && snap) {
      g.moveTo(drawingStart.x, drawingStart.y).lineTo(snap.x, snap.y);
      g.stroke({ width, color: GHOST_COLOR, alpha: 0.55, cap: 'round' });
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
        const r = 3 / zoom;
        g.moveTo(snap.x - r, snap.y).lineTo(snap.x + r, snap.y);
        g.moveTo(snap.x, snap.y - r).lineTo(snap.x, snap.y + r);
        g.stroke({ width: 1 / zoom, color: 0xffffff, alpha: 0.5 });
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
