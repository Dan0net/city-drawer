import { Container, Graphics } from 'pixi.js';
import type { EdgeId, Graph } from '@game/graph';
import type { Building, BuildingId } from '@game/buildings';
import type { AttributionLedgers, Link } from '@game/sim/attribution';
import { DEMAND_TYPES, type DemandDef, type DemandId } from '@game/demand/types';
import { ATTRIBUTION_NEAREST_RADIUS } from '@game/sim/config';
import type { BulldozeHover } from '@game/drawing/pointer';
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

interface SelectedLink {
  link: Link;
  def: DemandDef;
}

// Highlights ledger links touching whatever the user is hovering. Building
// → links where the building is source or sink. Edge → links whose stored
// path contains that edge (via edgeIndex). Node → union over the node's
// incident edges. Polylines come straight from each Link's stored `edges`,
// so hover viz matches actual flow.
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
    const key = hover
      ? `${hover.kind}:${hover.id}:${s.attributionsVersion}:${s.graphVersion}:${s.buildingsVersion}`
      : '';
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.g.clear();
    if (!hover) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    const selected = selectLinksForHover(hover, s.buildings, s.attributions, s.graph);
    const result = computeRoutes(selected, s.graph, s.buildings);
    for (const stroke of result.strokes) drawStroke(this.g, stroke);
    for (const dot of result.dots) drawDot(this.g, dot);
  }
}

export function selectLinksForHover(
  hover: BulldozeHover,
  buildings: Building[],
  ledgers: AttributionLedgers,
  graph: Graph,
): SelectedLink[] {
  if (hover.kind === 'building') {
    const target = buildings.find((b) => b.id === hover.id);
    return target ? selectLinksForBuilding(target, ledgers) : [];
  }
  if (hover.kind === 'edge') {
    const set = new Set<EdgeId>([hover.id]);
    return selectLinksForEdges(set, ledgers);
  }
  // node
  const node = graph.nodes.get(hover.id);
  if (!node) return [];
  return selectLinksForEdges(node.edges, ledgers);
}

function selectLinksForBuilding(target: Building, ledgers: AttributionLedgers): SelectedLink[] {
  const out: SelectedLink[] = [];
  const seen = new Set<Link>();
  for (const def of DEMAND_TYPES) {
    if (def.source.kind !== 'building') continue;
    const ledger = ledgers.get(def.id);
    if (!ledger) continue;
    if (def.sink.type === target.type) {
      const map = ledger.bySink.get(target.id);
      if (map) for (const link of map.values()) {
        if (!seen.has(link)) { seen.add(link); out.push({ link, def }); }
      }
    }
    if (def.source.type === target.type) {
      const map = ledger.bySource.get(target.id);
      if (map) for (const link of map.values()) {
        if (!seen.has(link)) { seen.add(link); out.push({ link, def }); }
      }
    }
  }
  return out;
}

function selectLinksForEdges(
  edgeIds: ReadonlySet<EdgeId>,
  ledgers: AttributionLedgers,
): SelectedLink[] {
  const out: SelectedLink[] = [];
  const seen = new Set<Link>();
  for (const def of DEMAND_TYPES) {
    if (def.source.kind !== 'building') continue;
    const ledger = ledgers.get(def.id);
    if (!ledger) continue;
    for (const eid of edgeIds) {
      const set = ledger.edgeIndex.get(eid);
      if (!set) continue;
      for (const link of set) {
        if (seen.has(link)) continue;
        seen.add(link);
        out.push({ link, def });
      }
    }
  }
  return out;
}

interface LabelAcc {
  wx: number;
  wy: number;
  color: number;
  slots: number;
  sumDirX: number;
  sumDirY: number;
}

export function computeRoutes(
  selected: ReadonlyArray<SelectedLink>,
  graph: Graph,
  buildings: Building[],
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

  for (const { link, def } of selected) {
    const dataSource = buildings.find((b) => b.id === link.sourceId);
    const dataSink = buildings.find((b) => b.id === link.sinkId);
    if (!dataSource || !dataSink) continue;
    let pts = polylineFromLink(graph, dataSource, dataSink, link);
    if (!pts || pts.length < 4) continue;
    if (def.flipArrow) pts = reversePts(pts);

    const visualSource = def.flipArrow ? dataSink : dataSource;
    const visualSink = def.flipArrow ? dataSource : dataSink;
    const color = paletteColor(def);
    const n = pts.length;
    const tipDx = pts[n - 2] - pts[n - 4];
    const tipDy = pts[n - 1] - pts[n - 3];
    const tipLen = Math.hypot(tipDx, tipDy) || 1;
    const ux = tipDx / tipLen;
    const uy = tipDy / tipLen;
    const startDx = pts[2] - pts[0];
    const startDy = pts[3] - pts[1];
    const startLen = Math.hypot(startDx, startDy) || 1;
    const sOutX = -startDx / startLen;
    const sOutY = -startDy / startLen;

    strokes.push({ pts, color, tipX: pts[n - 2], tipY: pts[n - 1], ux, uy });
    addLabel(visualSource.id, def.id, 's', visualSource.centroid.x, visualSource.centroid.y, sOutX, sOutY, color, link.slots);
    addLabel(visualSink.id, def.id, 'e', visualSink.centroid.x, visualSink.centroid.y, ux, uy, color, link.slots);

    const dotKey = `${visualSource.id}:${def.id}`;
    if (!dotMap.has(dotKey)) {
      dotMap.set(dotKey, { wx: visualSource.centroid.x, wy: visualSource.centroid.y, color });
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

function frontPoint(graph: Graph, b: Building): { x: number; y: number } | null {
  const c = b.consumed[0];
  if (!c) return null;
  const e = graph.edges.get(c.edgeId);
  if (!e) return null;
  const a = graph.nodes.get(e.from);
  const z = graph.nodes.get(e.to);
  if (!a || !z) return null;
  const t = (c.t0 + c.t1) * 0.5;
  return { x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t };
}

// Reconstruct polyline data-direction (source.centroid → sink.centroid)
// using the link's stored edge sequence. Matches the path the attribution
// helpers walked.
function polylineFromLink(
  graph: Graph,
  source: Building,
  sink: Building,
  link: Link,
): number[] | null {
  const sf = frontPoint(graph, source);
  const tf = frontPoint(graph, sink);
  if (!sf || !tf) return null;
  const startNode = graph.nearestNode(source.centroid.x, source.centroid.y, ATTRIBUTION_NEAREST_RADIUS);
  if (!startNode) return null;

  const pts: number[] = [source.centroid.x, source.centroid.y, sf.x, sf.y];
  let cur = startNode.id;
  pts.push(startNode.x, startNode.y);
  for (const eid of link.edges) {
    const e = graph.edges.get(eid);
    if (!e) return null;
    cur = e.from === cur ? e.to : e.from;
    const node = graph.nodes.get(cur);
    if (!node) return null;
    pts.push(node.x, node.y);
  }
  pts.push(tf.x, tf.y, sink.centroid.x, sink.centroid.y);
  return pts;
}

function reversePts(pts: number[]): number[] {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[pts.length - 2 - i] = pts[i];
    out[pts.length - 1 - i] = pts[i + 1];
  }
  return out;
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
