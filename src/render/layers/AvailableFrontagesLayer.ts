import { Container, Graphics } from 'pixi.js';
import { MIN_FRONTAGE_LENGTH } from '@game/buildings';
import { useWorldStore } from '@game/store/worldStore';
import {
  computeFrontageCorners,
  cornerKey,
  sideNormal,
  sideOffset,
  type Side,
} from '@game/roads/geometry';

const COLOR = 0x4ade80;
const WIDTH = 1.2;
const SIDES: readonly Side[] = ['left', 'right'];

// Debug overlay: draws the free frontage intervals stored on each graph edge
// as offset polylines on each side. Rebuilds on graphVersion changes.
export class AvailableFrontagesLayer {
  readonly container = new Container();
  private gfx = new Graphics();
  private lastGraphVersion = -1;

  constructor() {
    this.container.label = 'frontages';
    this.container.addChild(this.gfx);
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  update(): void {
    const s = useWorldStore.getState();
    if (s.graphVersion !== this.lastGraphVersion) {
      this.lastGraphVersion = s.graphVersion;
      this.rebuild();
    }
  }

  private rebuild(): void {
    const { graph } = useWorldStore.getState();
    this.gfx.clear();

    const corners = computeFrontageCorners(graph);

    let drew = false;
    for (const e of graph.edges.values()) {
      const front = graph.frontages.get(e.id);
      if (!front) continue;
      const a = graph.nodes.get(e.from)!;
      const b = graph.nodes.get(e.to)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const tx = dx / len;
      const ty = dy / len;
      const off = sideOffset(e.kind);

      for (const side of SIDES) {
        const n = sideNormal(tx, ty, side);
        const intervals = side === 'left' ? front.left : front.right;
        const fromCorner = corners.get(cornerKey(e.id, side, 'from'));
        const toCorner = corners.get(cornerKey(e.id, side, 'to'));
        for (const iv of intervals) {
          if (iv.t1 <= iv.t0) continue;
          if ((iv.t1 - iv.t0) * len < MIN_FRONTAGE_LENGTH) continue;
          const useFrom = iv.t0 === 0 && fromCorner !== undefined;
          const useTo = iv.t1 === 1 && toCorner !== undefined;
          const x0 = useFrom ? fromCorner!.x : a.x + dx * iv.t0 + n.nx * off;
          const y0 = useFrom ? fromCorner!.y : a.y + dy * iv.t0 + n.ny * off;
          const x1 = useTo ? toCorner!.x : a.x + dx * iv.t1 + n.nx * off;
          const y1 = useTo ? toCorner!.y : a.y + dy * iv.t1 + n.ny * off;
          this.gfx.moveTo(x0, y0).lineTo(x1, y1);
          drew = true;
        }
      }
    }

    if (drew) {
      this.gfx.stroke({ width: WIDTH, color: COLOR, alpha: 0.95, cap: 'round' });
    }
  }
}
