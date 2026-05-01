import { Container, Graphics } from 'pixi.js';
import { useWorldStore } from '@game/store/worldStore';

const ROAD_WIDTH = 8;
const SMALL_ROAD_WIDTH = 4;
const PATH_WIDTH = 2;
const ROAD_COLOR = 0x2c3038;
const SMALL_ROAD_COLOR = 0x3a4250;
const PATH_COLOR = 0x9a8a72;
const BULLDOZE_COLOR = 0xe55050;
const INSPECT_COLOR = 0xf5c542;

// Draws all edges in the graph. Rebuilds only when graph.version changes.
export class EdgesLayer {
  readonly container = new Container();
  private base = new Graphics();
  private hover = new Graphics();
  private lastGraphVersion = -1;
  private lastHover: string | null = null;

  constructor() {
    this.container.label = 'edges';
    this.container.addChild(this.base);
    this.container.addChild(this.hover);
  }

  // Called every frame from the main ticker.
  update(): void {
    const s = useWorldStore.getState();
    if (s.graphVersion !== this.lastGraphVersion) {
      this.lastGraphVersion = s.graphVersion;
      this.rebuild();
    }
    const target = s.bulldozeHover ?? s.hoverInfo;
    const hoverKey = target
      ? `${s.bulldozeHover ? 'b' : 'i'}:${target.kind}:${target.id}`
      : null;
    if (hoverKey !== this.lastHover) {
      this.lastHover = hoverKey;
      this.drawHover();
    }
  }

  private rebuild(): void {
    const { graph } = useWorldStore.getState();
    this.base.clear();

    // Paths first, then small roads, then roads on top so larger meets larger
    // cleanly at junctions.
    let drewPath = false;
    for (const e of graph.edges.values()) {
      if (e.kind !== 'path') continue;
      const a = graph.nodes.get(e.from)!;
      const b = graph.nodes.get(e.to)!;
      this.base.moveTo(a.x, a.y).lineTo(b.x, b.y);
      drewPath = true;
    }
    if (drewPath) {
      this.base.stroke({ width: PATH_WIDTH, color: PATH_COLOR, alpha: 0.95, cap: 'round' });
    }

    let drewSmall = false;
    for (const e of graph.edges.values()) {
      if (e.kind !== 'small_road') continue;
      const a = graph.nodes.get(e.from)!;
      const b = graph.nodes.get(e.to)!;
      this.base.moveTo(a.x, a.y).lineTo(b.x, b.y);
      drewSmall = true;
    }
    if (drewSmall) {
      this.base.stroke({
        width: SMALL_ROAD_WIDTH,
        color: SMALL_ROAD_COLOR,
        alpha: 1,
        cap: 'round',
      });
    }

    let drewRoad = false;
    for (const e of graph.edges.values()) {
      if (e.kind !== 'road') continue;
      const a = graph.nodes.get(e.from)!;
      const b = graph.nodes.get(e.to)!;
      this.base.moveTo(a.x, a.y).lineTo(b.x, b.y);
      drewRoad = true;
    }
    if (drewRoad) {
      this.base.stroke({ width: ROAD_WIDTH, color: ROAD_COLOR, alpha: 1, cap: 'round' });
    }
  }

  private drawHover(): void {
    const s = useWorldStore.getState();
    const target = s.bulldozeHover ?? s.hoverInfo;
    this.hover.clear();
    if (!target || target.kind === 'building') return;
    const color = s.bulldozeHover ? BULLDOZE_COLOR : INSPECT_COLOR;
    const { graph } = s;
    if (target.kind === 'edge') {
      const e = graph.edges.get(target.id);
      if (!e) return;
      const a = graph.nodes.get(e.from)!;
      const b = graph.nodes.get(e.to)!;
      const baseW =
        e.kind === 'road' ? ROAD_WIDTH : e.kind === 'small_road' ? SMALL_ROAD_WIDTH : PATH_WIDTH;
      this.hover.moveTo(a.x, a.y).lineTo(b.x, b.y);
      this.hover.stroke({ width: baseW + 3, color, alpha: 0.55, cap: 'round' });
      return;
    }
    // node: highlight the node, and for bulldoze also pre-stage incident edges.
    const n = graph.nodes.get(target.id);
    if (!n) return;
    if (s.bulldozeHover) {
      for (const eid of n.edges) {
        const e = graph.edges.get(eid);
        if (!e) continue;
        const a = graph.nodes.get(e.from)!;
        const b = graph.nodes.get(e.to)!;
        const baseW =
          e.kind === 'road' ? ROAD_WIDTH : e.kind === 'small_road' ? SMALL_ROAD_WIDTH : PATH_WIDTH;
        this.hover.moveTo(a.x, a.y).lineTo(b.x, b.y);
        this.hover.stroke({ width: baseW + 3, color, alpha: 0.55, cap: 'round' });
      }
    }
    this.hover.circle(n.x, n.y, ROAD_WIDTH).fill({ color, alpha: 0.6 });
  }
}
