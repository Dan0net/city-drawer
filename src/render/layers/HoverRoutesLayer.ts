import { Container, Graphics } from 'pixi.js';
import type { Graph, NodeId } from '@game/graph';
import { bfsPath } from '@game/graph/path';
import type { Building, BuildingId } from '@game/buildings';
import type { AttributionLedger, AttributionLedgers } from '@game/sim/attribution';
import { DEMAND_TYPES, type DemandDef, type DemandId } from '@game/demand/types';
import { useWorldStore } from '@game/store/worldStore';

const STROKE_WIDTH = 1.6;
const ARROW_LEN = 8;
const ARROW_HALF_W = 4;
const DOT_RADIUS = 2.5;
const colorScratch = new Uint8Array(4);

interface RouteStroke {
  pts: number[];
  color: number;
  tipX: number;
  tipY: number;
  ux: number;
  uy: number;
}

export interface RouteLabel {
  wx: number;
  wy: number;
  slots: number;
  color: number;
  // Screen-space offset direction from (wx, wy) toward where the badge sits.
  dirX: number;
  dirY: number;
}

interface RouteDot {
  wx: number;
  wy: number;
  color: number;
}

export interface RoutesResult {
  strokes: RouteStroke[];
  labels: RouteLabel[];
  dots: RouteDot[];
}

// Highlights ledger links touching the hovered building. Polyline +
// arrowhead + start-dot draw here in Pixi; slot-count labels are produced
// for HoverRouteLabels (DOM-rendered for crisp text). Routes connect
// centroid → road-front-point → ...graph... → road-front-point → centroid.
// `def.flipArrow` reverses the visual direction (jobs).
export class HoverRoutesLayer {
  readonly container = new Container();
  private g = new Graphics();
  private lastKey = '';

  constructor() {
    this.container.label = 'hover-routes';
    this.container.addChild(this.g);
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
    this.g.clear();
    if (target == null) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    const tgt = s.buildings.find((b) => b.id === target);
    if (!tgt) return;
    const result = computeRoutes(tgt, s.graph, s.buildings, s.attributions);
    for (const stroke of result.strokes) drawStroke(this.g, stroke);
    for (const dot of result.dots) drawDot(this.g, dot);
  }
}

interface LabelAcc {
  wx: number;
  wy: number;
  color: number;
  slots: number;
  sumDirX: number;
  sumDirY: number;
}

// Public — also consumed by HoverRouteLabels in the UI layer.
export function computeRoutes(
  target: Building,
  graph: Graph,
  buildings: Building[],
  ledgers: AttributionLedgers,
): RoutesResult {
  const strokes: RouteStroke[] = [];
  const labelMap = new Map<string, LabelAcc>();
  const dotMap = new Map<string, RouteDot>();

  const addLabel = (
    bId: BuildingId,
    demandId: DemandId,
    side: 's' | 'e',
    wx: number,
    wy: number,
    dirX: number,
    dirY: number,
    color: number,
    slots: number,
  ): void => {
    const k = `${bId}:${demandId}:${side}`;
    const acc = labelMap.get(k);
    if (acc) {
      acc.slots += slots;
      acc.sumDirX += dirX;
      acc.sumDirY += dirY;
      return;
    }
    labelMap.set(k, { wx, wy, color, slots, sumDirX: dirX, sumDirY: dirY });
  };

  for (const def of DEMAND_TYPES) {
    if (def.source.kind !== 'building') continue;
    const ledger = ledgers.get(def.id);
    if (!ledger) continue;
    const color = paletteColor(def);
    if (def.sink.type === target.type) {
      collectLinks(target, ledger, def, graph, buildings, color, 'sink', strokes, addLabel, dotMap);
    }
    if (def.source.type === target.type) {
      collectLinks(target, ledger, def, graph, buildings, color, 'source', strokes, addLabel, dotMap);
    }
  }

  const labels: RouteLabel[] = [];
  for (const acc of labelMap.values()) {
    const len = Math.hypot(acc.sumDirX, acc.sumDirY) || 1;
    labels.push({
      wx: acc.wx,
      wy: acc.wy,
      slots: acc.slots,
      color: acc.color,
      dirX: acc.sumDirX / len,
      dirY: acc.sumDirY / len,
    });
  }
  return { strokes, labels, dots: [...dotMap.values()] };
}

function collectLinks(
  target: Building,
  ledger: AttributionLedger,
  def: DemandDef,
  graph: Graph,
  buildings: Building[],
  color: number,
  role: 'sink' | 'source',
  strokes: RouteStroke[],
  addLabel: (
    bId: BuildingId, demandId: DemandId, side: 's' | 'e',
    wx: number, wy: number, dirX: number, dirY: number,
    color: number, slots: number,
  ) => void,
  dotMap: Map<string, RouteDot>,
): void {
  const links = role === 'sink' ? ledger.bySink.get(target.id) : ledger.bySource.get(target.id);
  if (!links || links.size === 0) return;
  for (const [otherId, slots] of links) {
    const other = buildings.find((b) => b.id === otherId);
    if (!other) continue;
    const dataSink = role === 'sink' ? target : other;
    const dataSource = role === 'sink' ? other : target;
    const visualSource = def.flipArrow ? dataSink : dataSource;
    const visualSink = def.flipArrow ? dataSource : dataSink;
    const pts = routePoints(graph, visualSource, visualSink);
    if (!pts || pts.length < 4) continue;
    const n = pts.length;
    const tipDx = pts[n - 2] - pts[n - 4];
    const tipDy = pts[n - 1] - pts[n - 3];
    const tipLen = Math.hypot(tipDx, tipDy) || 1;
    const ux = tipDx / tipLen;
    const uy = tipDy / tipLen;
    const startDx = pts[2] - pts[0];
    const startDy = pts[3] - pts[1];
    const startLen = Math.hypot(startDx, startDy) || 1;
    // Outward direction at the start: opposite of where the line is heading.
    const sOutX = -startDx / startLen;
    const sOutY = -startDy / startLen;

    strokes.push({ pts, color, tipX: pts[n - 2], tipY: pts[n - 1], ux, uy });
    addLabel(visualSource.id, def.id, 's', visualSource.centroid.x, visualSource.centroid.y, sOutX, sOutY, color, slots);
    addLabel(visualSink.id, def.id, 'e', visualSink.centroid.x, visualSink.centroid.y, ux, uy, color, slots);

    const dotKey = `${visualSource.id}:${def.id}`;
    if (!dotMap.has(dotKey)) {
      dotMap.set(dotKey, { wx: visualSource.centroid.x, wy: visualSource.centroid.y, color });
    }
  }
}

interface FrontEdge {
  pt: { x: number; y: number };
  edgeId: number;
  fromId: NodeId;
  toId: NodeId;
}

function frontEdge(graph: Graph, b: Building): FrontEdge | null {
  const c = b.consumed[0];
  if (!c) return null;
  const e = graph.edges.get(c.edgeId);
  if (!e) return null;
  const a = graph.nodes.get(e.from);
  const z = graph.nodes.get(e.to);
  if (!a || !z) return null;
  const t = (c.t0 + c.t1) * 0.5;
  return {
    pt: { x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t },
    edgeId: e.id,
    fromId: e.from,
    toId: e.to,
  };
}

function pickExitNode(from: FrontEdge, target: { x: number; y: number }, graph: Graph): NodeId {
  const a = graph.nodes.get(from.fromId)!;
  const z = graph.nodes.get(from.toId)!;
  const da = (a.x - target.x) ** 2 + (a.y - target.y) ** 2;
  const dz = (z.x - target.x) ** 2 + (z.y - target.y) ** 2;
  return da <= dz ? from.fromId : from.toId;
}

function routePoints(graph: Graph, source: Building, sink: Building): number[] | null {
  const sf = frontEdge(graph, source);
  const tf = frontEdge(graph, sink);
  if (!sf || !tf) return null;
  const pts: number[] = [source.centroid.x, source.centroid.y, sf.pt.x, sf.pt.y];
  if (sf.edgeId !== tf.edgeId) {
    const exitId = pickExitNode(sf, tf.pt, graph);
    const entryId = pickExitNode(tf, sf.pt, graph);
    const path = bfsPath(graph, exitId, entryId);
    if (path.length === 0) return null;
    for (const id of path) {
      const n = graph.nodes.get(id);
      if (n) pts.push(n.x, n.y);
    }
  }
  pts.push(tf.pt.x, tf.pt.y, sink.centroid.x, sink.centroid.y);
  return pts;
}

function paletteColor(def: DemandDef): number {
  def.palette(1, 1, colorScratch, 0);
  return (colorScratch[0] << 16) | (colorScratch[1] << 8) | colorScratch[2];
}

function drawStroke(g: Graphics, r: RouteStroke): void {
  const { pts, color, tipX, tipY, ux, uy } = r;
  const baseX = tipX - ux * ARROW_LEN;
  const baseY = tipY - uy * ARROW_LEN;
  const n = pts.length;

  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < n - 2; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.lineTo(baseX, baseY);
  g.stroke({ width: STROKE_WIDTH, color, alpha: 0.5, cap: 'round', join: 'round' });

  const px = -uy * ARROW_HALF_W;
  const py = ux * ARROW_HALF_W;
  g.moveTo(tipX, tipY)
    .lineTo(baseX + px, baseY + py)
    .lineTo(baseX - px, baseY - py)
    .closePath()
    .fill({ color, alpha: 1 });
}

function drawDot(g: Graphics, d: RouteDot): void {
  g.circle(d.wx, d.wy, DOT_RADIUS).fill({ color: d.color, alpha: 1 });
}
