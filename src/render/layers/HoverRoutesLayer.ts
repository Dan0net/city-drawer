import { Container, Graphics, Text } from 'pixi.js';
import type { Graph, NodeId } from '@game/graph';
import { bfsPath } from '@game/graph/path';
import type { BuildingId, Building } from '@game/buildings';
import type { AttributionLedger, AttributionLedgers } from '@game/sim/attribution';
import { DEMAND_TYPES, type DemandDef } from '@game/demand/types';
import { useWorldStore } from '@game/store/worldStore';

const STROKE_WIDTH = 1.6;
const ARROW_LEN = 8;
const ARROW_HALF_W = 4;
const LABEL_OFFSET = 6;
const colorScratch = new Uint8Array(4);

interface RouteRender {
  // Polyline points (world coords) — first node at source, last at sink.
  pts: number[];
  color: number;
  slots: number;
}

// Highlights the ledger links touching the hovered building. Hover on a
// source draws its outgoing routes to every sink it supplies; hover on a
// sink draws its incoming routes from every source. Each route is a
// polyline along the graph, demand-colored, with an arrowhead at the sink
// end and a slot-count label.
export class HoverRoutesLayer {
  readonly container = new Container();
  private g = new Graphics();
  private labels = new Container();
  private lastKey = '';

  constructor() {
    this.container.label = 'hover-routes';
    this.container.addChild(this.g);
    this.container.addChild(this.labels);
  }

  update(): void {
    const s = useWorldStore.getState();
    const hover = s.hoverInfo;
    const target = hover?.kind === 'building' ? hover.id : null;
    const key = target == null
      ? ''
      : `${target}:${s.attributionsVersion}:${s.graphVersion}:${s.buildingsVersion}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.rebuild(target);
  }

  private clear(): void {
    this.g.clear();
    for (const child of this.labels.removeChildren()) child.destroy();
  }

  private rebuild(targetId: BuildingId | null): void {
    this.clear();
    if (targetId == null) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    const { graph, buildings, attributions } = useWorldStore.getState();
    const target = buildings.find((b) => b.id === targetId);
    if (!target) return;

    const routes = collectRoutes(target, graph, buildings, attributions);
    for (const r of routes) drawRoute(this.g, this.labels, r);
  }
}

function collectRoutes(
  target: Building,
  graph: Graph,
  buildings: Building[],
  ledgers: AttributionLedgers,
): RouteRender[] {
  const out: RouteRender[] = [];
  for (const def of DEMAND_TYPES) {
    if (def.source.kind !== 'building') continue;
    const ledger = ledgers.get(def.id);
    if (!ledger) continue;
    if (def.sink.type === target.type) {
      addLinks(out, target, ledger, def, graph, buildings, 'sink');
    }
    if (def.source.type === target.type) {
      addLinks(out, target, ledger, def, graph, buildings, 'source');
    }
  }
  return out;
}

function addLinks(
  out: RouteRender[],
  target: Building,
  ledger: AttributionLedger,
  def: DemandDef,
  graph: Graph,
  buildings: Building[],
  role: 'sink' | 'source',
): void {
  const links = role === 'sink' ? ledger.bySink.get(target.id) : ledger.bySource.get(target.id);
  if (!links || links.size === 0) return;
  const color = paletteColor(def);
  for (const [otherId, slots] of links) {
    const other = buildings.find((b) => b.id === otherId);
    if (!other) continue;
    const sink = role === 'sink' ? target : other;
    const source = role === 'sink' ? other : target;
    const fromNode = graph.nearestNode(source.centroid.x, source.centroid.y, 96);
    const toNode = graph.nearestNode(sink.centroid.x, sink.centroid.y, 96);
    if (!fromNode || !toNode) continue;
    const path = bfsPath(graph, fromNode.id, toNode.id);
    if (path.length === 0) continue;
    const pts = pathPoints(graph, path, source.centroid, sink.centroid);
    if (pts.length < 4) continue;
    out.push({ pts, color, slots });
  }
}

function pathPoints(
  graph: Graph,
  path: NodeId[],
  source: { x: number; y: number },
  sink: { x: number; y: number },
): number[] {
  const pts: number[] = [source.x, source.y];
  for (const id of path) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    pts.push(n.x, n.y);
  }
  pts.push(sink.x, sink.y);
  return pts;
}

function paletteColor(def: DemandDef): number {
  def.palette(1, 1, colorScratch, 0);
  return (colorScratch[0] << 16) | (colorScratch[1] << 8) | colorScratch[2];
}

function drawRoute(g: Graphics, labels: Container, r: RouteRender): void {
  const { pts, color, slots } = r;
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke({ width: STROKE_WIDTH, color, alpha: 0.95, cap: 'round', join: 'round' });

  const n = pts.length;
  const tipX = pts[n - 2];
  const tipY = pts[n - 1];
  const prevX = pts[n - 4];
  const prevY = pts[n - 3];
  const dx = tipX - prevX;
  const dy = tipY - prevY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const baseX = tipX - ux * ARROW_LEN;
  const baseY = tipY - uy * ARROW_LEN;
  const px = -uy * ARROW_HALF_W;
  const py = ux * ARROW_HALF_W;
  g.moveTo(tipX, tipY)
    .lineTo(baseX + px, baseY + py)
    .lineTo(baseX - px, baseY - py)
    .closePath()
    .fill({ color, alpha: 1 });

  const label = new Text({
    text: String(slots),
    style: {
      fontFamily: 'ui-monospace, monospace',
      fontSize: 10,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 3 },
    },
  });
  label.anchor.set(0.5);
  label.position.set(baseX - ux * LABEL_OFFSET, baseY - uy * LABEL_OFFSET);
  labels.addChild(label);
}
