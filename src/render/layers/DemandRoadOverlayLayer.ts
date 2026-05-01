import { Container, Graphics, ImageSource, Matrix, Texture } from 'pixi.js';
import { useUiStore } from '@game/store/uiStore';
import { useWorldStore } from '@game/store/worldStore';

const ROAD_WIDTH = 8;
const SMALL_ROAD_WIDTH = 4;
const PATH_WIDTH = 2;

// 1-pixel-tall gradient strip; only the long axis is sampled along the edge.
const TEX_W = 256;

const colorScratchA = new Uint8Array(4);
const colorScratchB = new Uint8Array(4);

// Tints edges with the active demand map's palette using a true linear gradient
// from node-A's value to node-B's value.
//
// Pixi 8.x's FillGradient has a bug for edges with mixed-sign deltas
// (one of dx/dy negative, the other positive): its partial start/end swap
// inside buildLinearGradient anchors the texture on the wrong corner of the
// bounding box, so the gradient runs across the edge instead of along it.
// We sidestep that by building our own 1×N gradient texture and applying it
// via a fill { texture, matrix } — the matrix path through the renderer
// has no sign branching, so it works for every direction.
export class DemandRoadOverlayLayer {
  readonly container = new Container();
  private g = new Graphics();
  private textures: Texture[] = [];
  private lastKey = '';

  constructor() {
    this.container.label = 'demand-road-overlay';
    this.container.addChild(this.g);
  }

  update(): void {
    const activeId = useUiStore.getState().activeDemandMap;
    const { graphVersion, demandMapsVersion } = useWorldStore.getState();

    if (!activeId) {
      if (this.lastKey !== '') {
        this.clearGeometry();
        this.lastKey = '';
      }
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    const key = `${activeId}:${graphVersion}:${demandMapsVersion}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.rebuild();
  }

  private clearGeometry(): void {
    this.g.clear();
    for (const t of this.textures) t.destroy(true);
    this.textures.length = 0;
  }

  private rebuild(): void {
    const { graph, demandMaps } = useWorldStore.getState();
    const activeId = useUiStore.getState().activeDemandMap;
    const map = demandMaps.find((m) => m.id === activeId);
    this.clearGeometry();
    if (!map) return;

    for (const e of graph.edges.values()) {
      const a = graph.nodes.get(e.from)!;
      const b = graph.nodes.get(e.to)!;
      const va = map.roadField.get(a.id) ?? 0;
      const vb = map.roadField.get(b.id) ?? 0;
      if (va < 1e-3 && vb < 1e-3) continue;

      // Each map's palette is responsible for its own value range / clamping.
      // Resource is already 0..1; jobs scales internally by JOB_SUPPLY.
      map.palette(va, map.graphSat, colorScratchA, 0);
      map.palette(vb, map.graphSat, colorScratchB, 0);

      const baseW =
        e.kind === 'road' ? ROAD_WIDTH : e.kind === 'small_road' ? SMALL_ROAD_WIDTH : PATH_WIDTH;
      const halfW = (baseW + 2) * 0.5;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const px = (-dy / len) * halfW;
      const py = (dx / len) * halfW;

      const texture = buildGradientTexture(colorScratchA, colorScratchB);
      this.textures.push(texture);

      // Texture-pixel (0,0) → world A; (TEX_W, 0) → world B.
      const matrix = new Matrix();
      matrix.scale(len / TEX_W, 1);
      matrix.rotate(Math.atan2(dy, dx));
      matrix.translate(a.x, a.y);

      this.g
        .poly([
          a.x + px, a.y + py,
          b.x + px, b.y + py,
          b.x - px, b.y - py,
          a.x - px, a.y - py,
        ])
        .fill({ texture, matrix, textureSpace: 'global' });
    }
  }
}

function buildGradientTexture(a: Uint8Array, b: Uint8Array): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, TEX_W, 0);
  grad.addColorStop(0, `rgba(${a[0]}, ${a[1]}, ${a[2]}, ${a[3] / 255})`);
  grad.addColorStop(1, `rgba(${b[0]}, ${b[1]}, ${b[2]}, ${b[3] / 255})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TEX_W, 1);
  return new Texture({ source: new ImageSource({ resource: canvas }) });
}
