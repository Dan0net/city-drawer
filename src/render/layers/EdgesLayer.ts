import { Container, Graphics } from 'pixi.js';
import type { NodeId } from '@game/graph';
import { useWorldStore } from '@game/store/worldStore';

const ROAD_WIDTH = 8;
const SMALL_ROAD_WIDTH = 4;
const PATH_WIDTH = 2;
const BULLDOZE_COLOR = 0xe55050;
const INSPECT_COLOR = 0xf5c542;

// Traffic ramp endpoints (RGB).
const COLD_R = 64, COLD_G = 200, COLD_B = 80;   // green
const HOT_R = 220, HOT_G = 50, HOT_B = 60;      // red

// Number of segments per edge for the traffic gradient. 10 is enough that
// the eye reads it as a smooth lerp at typical zoom levels.
const GRADIENT_SEGMENTS = 10;

const widthOf = (kind: 'road' | 'small_road' | 'path'): number =>
  kind === 'road' ? ROAD_WIDTH : kind === 'small_road' ? SMALL_ROAD_WIDTH : PATH_WIDTH;

const trafficColor = (t: number, max: number): number => {
  if (max <= 0) return rgb(COLD_R, COLD_G, COLD_B);
  const k = Math.max(0, Math.min(1, t / max));
  const r = Math.round(COLD_R + (HOT_R - COLD_R) * k);
  const g = Math.round(COLD_G + (HOT_G - COLD_G) * k);
  const b = Math.round(COLD_B + (HOT_B - COLD_B) * k);
  return rgb(r, g, b);
};

const rgb = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

// Draws all edges in the graph. Each edge colored by its traffic share —
// green at zero, red at the global max. Rebuilds when graph or traffic
// changes; redraws hover overlay independently.
export class EdgesLayer {
  readonly container = new Container();
  private base = new Graphics();
  private hover = new Graphics();
  private lastGraphVersion = -1;
  private lastTrafficVersion = -1;
  private lastHover: string | null = null;

  constructor() {
    this.container.label = 'edges';
    this.container.addChild(this.base);
    this.container.addChild(this.hover);
  }

  update(): void {
    const s = useWorldStore.getState();
    if (
      s.graphVersion !== this.lastGraphVersion ||
      s.trafficVersion !== this.lastTrafficVersion
    ) {
      this.lastGraphVersion = s.graphVersion;
      this.lastTrafficVersion = s.trafficVersion;
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
    const { graph, traffic } = useWorldStore.getState();
    this.base.clear();

    // Per-node traffic value = mean of incident edges' traffic. Used as the
    // gradient endpoints so adjacent edges share a color at their shared
    // junction and the heat map reads as a continuous network.
    const nodeTraffic = new Map<NodeId, number>();
    for (const node of graph.nodes.values()) {
      let sum = 0;
      for (const eid of node.edges) sum += traffic.perEdge.get(eid) ?? 0;
      nodeTraffic.set(node.id, node.edges.size > 0 ? sum / node.edges.size : 0);
    }

    for (const e of graph.edges.values()) {
      const a = graph.nodes.get(e.from)!;
      const b = graph.nodes.get(e.to)!;
      const ta = nodeTraffic.get(e.from) ?? 0;
      const tb = nodeTraffic.get(e.to) ?? 0;
      const w = widthOf(e.kind);
      // Subdivide and stroke per segment with the lerped color. 'round' cap
      // hides the seams between same-color neighbors.
      for (let i = 0; i < GRADIENT_SEGMENTS; i++) {
        const t0 = i / GRADIENT_SEGMENTS;
        const t1 = (i + 1) / GRADIENT_SEGMENTS;
        const tMid = (t0 + t1) * 0.5;
        const segColor = trafficColor(ta + (tb - ta) * tMid, traffic.max);
        this.base
          .moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0)
          .lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1)
          .stroke({ width: w, color: segColor, alpha: 1, cap: 'round' });
      }
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
      this.hover.moveTo(a.x, a.y).lineTo(b.x, b.y);
      this.hover.stroke({ width: widthOf(e.kind) + 3, color, alpha: 0.55, cap: 'round' });
      return;
    }
    const n = graph.nodes.get(target.id);
    if (!n) return;
    if (s.bulldozeHover) {
      for (const eid of n.edges) {
        const e = graph.edges.get(eid);
        if (!e) continue;
        const a = graph.nodes.get(e.from)!;
        const b = graph.nodes.get(e.to)!;
        this.hover.moveTo(a.x, a.y).lineTo(b.x, b.y);
        this.hover.stroke({ width: widthOf(e.kind) + 3, color, alpha: 0.55, cap: 'round' });
      }
    }
    this.hover.circle(n.x, n.y, ROAD_WIDTH).fill({ color, alpha: 0.6 });
  }
}
