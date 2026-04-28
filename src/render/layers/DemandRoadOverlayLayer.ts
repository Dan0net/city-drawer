import { Container, Graphics } from 'pixi.js';
import { useUiStore } from '@game/store/uiStore';
import { useWorldStore } from '@game/store/worldStore';
import type { DemandMap } from '@game/demand/maps';

const ROAD_WIDTH = 8;
const SMALL_ROAD_WIDTH = 4;
const PATH_WIDTH = 2;

// One small rgba buffer reused by every palette call (palette signature writes
// into a Uint8Array at an offset).
const colorScratch = new Uint8Array(4);

// Tints edges with the active demand map's palette using the average of the
// endpoint nodes' road-field values. Drawn over EdgesLayer.
export class DemandRoadOverlayLayer {
  readonly container = new Container();
  private g = new Graphics();
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
        this.g.clear();
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

  private rebuild(): void {
    const { graph, demandMaps } = useWorldStore.getState();
    const activeId = useUiStore.getState().activeDemandMap;
    const map = demandMaps.find((m) => m.id === activeId);
    this.g.clear();
    if (!map) return;

    for (const e of graph.edges.values()) {
      const a = graph.nodes.get(e.from)!;
      const b = graph.nodes.get(e.to)!;
      const va = map.roadField.get(a.id) ?? 0;
      const vb = map.roadField.get(b.id) ?? 0;
      const v = (va + vb) * 0.5;
      if (v < 1e-3) continue;
      strokeColor(map, v);
      const baseW =
        e.kind === 'road' ? ROAD_WIDTH : e.kind === 'small_road' ? SMALL_ROAD_WIDTH : PATH_WIDTH;
      const color =
        (colorScratch[0] << 16) | (colorScratch[1] << 8) | colorScratch[2];
      const alpha = colorScratch[3] / 255;
      this.g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      this.g.stroke({ width: baseW + 2, color, alpha, cap: 'round' });
    }
  }
}

function strokeColor(map: DemandMap, v: number): void {
  map.palette(Math.min(1, v), colorScratch, 0);
}
