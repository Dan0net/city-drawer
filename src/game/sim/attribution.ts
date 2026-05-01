import type { EdgeId, Graph, NodeId } from '@game/graph';
import { bfsParents, pathEdgesFromParents, type BfsParent } from '@game/graph/path';
import { buildingAnchor, type Building, type BuildingId } from '@game/buildings';
import { DEMAND_TYPES, type DemandDef, type DemandId } from '@game/demand/types';

export interface Link {
  sourceId: BuildingId;
  sinkId: BuildingId;
  slots: number;
  // Source-anchor node id — the start of `edges`. Pinned at attribution time
  // so path replay (hover viz, future re-routing) walks the same node
  // sequence the BFS used, even after splits remap consumed edges.
  sourceAnchor: NodeId;
  edges: EdgeId[];
}

export interface AttributionLedger {
  bySink: Map<BuildingId, Map<BuildingId, Link>>;
  bySource: Map<BuildingId, Map<BuildingId, Link>>;
  totalSlots: number;
  // Reverse index: every Link is registered against each edge in its path,
  // so dropLinksThroughEdges is O(deadEdges + affectedLinks) instead of
  // O(allLinks × pathLength).
  edgeIndex: Map<EdgeId, Set<Link>>;
}

export type AttributionLedgers = Map<DemandId, AttributionLedger>;

export interface TrafficState {
  perEdge: Map<EdgeId, number>;
  max: number;
}

export const createTraffic = (): TrafficState => ({ perEdge: new Map(), max: 0 });

export const resetTraffic = (t: TrafficState): void => {
  t.perEdge.clear();
  t.max = 0;
};

export function createAttributionLedgers(): AttributionLedgers {
  const m: AttributionLedgers = new Map();
  for (const def of DEMAND_TYPES) {
    m.set(def.id, {
      bySink: new Map(),
      bySource: new Map(),
      totalSlots: 0,
      edgeIndex: new Map(),
    });
  }
  return m;
}

export const resetLedger = (l: AttributionLedger): void => {
  l.bySink.clear();
  l.bySource.clear();
  l.edgeIndex.clear();
  l.totalSlots = 0;
};

export const slotsGivenBy = (ledger: AttributionLedger, sourceId: BuildingId): number => {
  const inner = ledger.bySource.get(sourceId);
  if (!inner) return 0;
  let s = 0;
  for (const link of inner.values()) s += link.slots;
  return s;
};

export const slotsClaimedBy = (ledger: AttributionLedger, sinkId: BuildingId): number => {
  const inner = ledger.bySink.get(sinkId);
  if (!inner) return 0;
  let s = 0;
  for (const link of inner.values()) s += link.slots;
  return s;
};

// Total slots a sink wants for a demand, independent of source count.
export const sinkSlotDemand = (sink: Building, def: DemandDef): number => {
  const unit = def.unitArea ?? 1;
  const mult = def.sink.consumption ?? 1;
  return Math.max(1, Math.floor(sink.area / unit)) * mult;
};

const creditTraffic = (traffic: TrafficState, edges: EdgeId[], slots: number): void => {
  for (const e of edges) {
    const next = (traffic.perEdge.get(e) ?? 0) + slots;
    traffic.perEdge.set(e, next);
    if (next > traffic.max) traffic.max = next;
  }
};

const debitTraffic = (traffic: TrafficState, edges: EdgeId[], slots: number): boolean => {
  let touchedMax = false;
  for (const e of edges) {
    const cur = traffic.perEdge.get(e) ?? 0;
    const next = cur - slots;
    if (cur >= traffic.max) touchedMax = true;
    if (next <= 0) traffic.perEdge.delete(e);
    else traffic.perEdge.set(e, next);
  }
  return touchedMax;
};

const recomputeTrafficMax = (traffic: TrafficState): void => {
  let m = 0;
  for (const v of traffic.perEdge.values()) if (v > m) m = v;
  traffic.max = m;
};

const indexLink = (ledger: AttributionLedger, link: Link): void => {
  for (const e of link.edges) {
    let set = ledger.edgeIndex.get(e);
    if (!set) {
      set = new Set();
      ledger.edgeIndex.set(e, set);
    }
    set.add(link);
  }
};

const unindexLink = (ledger: AttributionLedger, link: Link): void => {
  for (const e of link.edges) {
    const set = ledger.edgeIndex.get(e);
    if (!set) continue;
    set.delete(link);
    if (set.size === 0) ledger.edgeIndex.delete(e);
  }
};

// Single chokepoint for tearing a link out of every collection that holds it,
// debiting traffic, and bookkeeping totalSlots / max. Both bulldoze paths
// (per-building, per-edge) call this — no duplicated cleanup logic.
const removeLink = (
  ledger: AttributionLedger,
  link: Link,
  traffic: TrafficState,
): { wasMaxTouched: boolean } => {
  const wasMaxTouched = debitTraffic(traffic, link.edges, link.slots);
  const sinkInner = ledger.bySink.get(link.sinkId);
  if (sinkInner) {
    sinkInner.delete(link.sourceId);
    if (sinkInner.size === 0) ledger.bySink.delete(link.sinkId);
  }
  const srcInner = ledger.bySource.get(link.sourceId);
  if (srcInner) {
    srcInner.delete(link.sinkId);
    if (srcInner.size === 0) ledger.bySource.delete(link.sourceId);
  }
  unindexLink(ledger, link);
  ledger.totalSlots -= link.slots;
  return { wasMaxTouched };
};

const getOrCreateInner = <K, V>(m: Map<K, Map<K, V>>, k: K): Map<K, V> => {
  let inner = m.get(k);
  if (!inner) {
    inner = new Map();
    m.set(k, inner);
  }
  return inner;
};

// Add `slots` from sourceId to sinkId. New pair → store path + index by edge.
// Existing pair → bump slots, traffic credits along the original path; the
// freshly-walked `edges`/`sourceAnchor` are ignored. Keeping the original
// path means a link's recorded route stays valid until its edges are
// explicitly dropped (via building or edge bulldoze), at which point the
// link goes too.
const addAttribution = (
  ledger: AttributionLedger,
  sinkId: BuildingId,
  sourceId: BuildingId,
  slots: number,
  sourceAnchor: NodeId,
  edges: EdgeId[],
  traffic: TrafficState,
): void => {
  if (slots <= 0) return;
  const sinkInner = getOrCreateInner(ledger.bySink, sinkId);
  const existing = sinkInner.get(sourceId);
  if (existing) {
    existing.slots += slots;
    creditTraffic(traffic, existing.edges, slots);
  } else {
    const link: Link = { sourceId, sinkId, slots, sourceAnchor, edges };
    sinkInner.set(sourceId, link);
    getOrCreateInner(ledger.bySource, sourceId).set(sinkId, link);
    indexLink(ledger, link);
    creditTraffic(traffic, edges, slots);
  }
  ledger.totalSlots += slots;
};

export interface DroppedLinks {
  asSink: Map<DemandId, BuildingId[]>;
  asSource: Map<DemandId, BuildingId[]>;
}

const emptyDropped = (): DroppedLinks => ({ asSink: new Map(), asSource: new Map() });

const recordCounterparty = (
  out: Map<DemandId, BuildingId[]>,
  demandId: DemandId,
  id: BuildingId,
): void => {
  let list = out.get(demandId);
  if (!list) {
    list = [];
    out.set(demandId, list);
  }
  list.push(id);
};

// Drop every link touching `id` (in either role). Returns counterparties so
// `settleAfterDrop` can refill them.
export function dropFromLedgers(
  ledgers: AttributionLedgers,
  id: BuildingId,
  traffic: TrafficState,
): DroppedLinks {
  const dropped = emptyDropped();
  let touchedMax = false;
  for (const [demandId, ledger] of ledgers) {
    const sinkInner = ledger.bySink.get(id);
    if (sinkInner) {
      // Snapshot — removeLink mutates the inner map.
      const links = [...sinkInner.values()];
      for (const link of links) {
        recordCounterparty(dropped.asSink, demandId, link.sourceId);
        if (removeLink(ledger, link, traffic).wasMaxTouched) touchedMax = true;
      }
    }
    const srcInner = ledger.bySource.get(id);
    if (srcInner) {
      const links = [...srcInner.values()];
      for (const link of links) {
        recordCounterparty(dropped.asSource, demandId, link.sinkId);
        if (removeLink(ledger, link, traffic).wasMaxTouched) touchedMax = true;
      }
    }
  }
  if (touchedMax) recomputeTrafficMax(traffic);
  return dropped;
}

// Drop every link whose path crosses any edge in `deadEdges`. Used by the
// edge / node bulldoze flow to invalidate stale attributions and let
// settleAfterDrop reroute their counterparties on the new graph.
export function dropLinksThroughEdges(
  ledgers: AttributionLedgers,
  deadEdges: ReadonlySet<EdgeId>,
  traffic: TrafficState,
): DroppedLinks {
  const dropped = emptyDropped();
  let touchedMax = false;
  for (const [demandId, ledger] of ledgers) {
    // Snapshot affected links first — removeLink mutates edgeIndex.
    const affected = new Set<Link>();
    for (const e of deadEdges) {
      const set = ledger.edgeIndex.get(e);
      if (!set) continue;
      for (const link of set) affected.add(link);
    }
    for (const link of affected) {
      recordCounterparty(dropped.asSink, demandId, link.sourceId);
      recordCounterparty(dropped.asSource, demandId, link.sinkId);
      if (removeLink(ledger, link, traffic).wasMaxTouched) touchedMax = true;
    }
  }
  if (touchedMax) recomputeTrafficMax(traffic);
  return dropped;
}

interface FillCtx {
  graph: Graph;
  buildings: Building[];
  ledgers: AttributionLedgers;
  traffic: TrafficState;
}

const bucketByAnchor = (
  graph: Graph,
  buildings: Building[],
  predicate: (b: Building) => boolean,
): Map<NodeId, Building[]> => {
  const buckets = new Map<NodeId, Building[]>();
  for (const b of buildings) {
    if (!predicate(b)) continue;
    const anchor = buildingAnchor(graph, b);
    if (anchor == null) continue;
    const list = buckets.get(anchor);
    if (list) list.push(b);
    else buckets.set(anchor, [b]);
  }
  return buckets;
};

// Walk `parents` (a BFS map) in hop-count order — same order BFS itself
// would visit them. Stops when `visit` returns true.
const walkBfsLayers = (
  parents: Map<NodeId, BfsParent>,
  start: NodeId,
  graph: Graph,
  visit: (n: NodeId) => boolean,
): void => {
  const visited = new Set<NodeId>([start]);
  const queue: NodeId[] = [start];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (visit(n)) return;
    const node = graph.nodes.get(n);
    if (!node) continue;
    for (const eid of node.edges) {
      const e = graph.edges.get(eid);
      if (!e) continue;
      const other = e.from === n ? e.to : e.from;
      if (visited.has(other) || !parents.has(other)) continue;
      visited.add(other);
      queue.push(other);
    }
  }
};

// Pull slots into `sinkId` from closest sources-with-slack, hop-by-hop, until
// the sink's demand is satisfied OR the graph is exhausted. Partial fill OK.
export function fillFromNewSink(sinkId: BuildingId, def: DemandDef, ctx: FillCtx): void {
  if (def.source.kind !== 'building') return;
  const ledger = ctx.ledgers.get(def.id)!;
  const sink = ctx.buildings.find((b) => b.id === sinkId);
  if (!sink) return;
  let remaining = sinkSlotDemand(sink, def) - slotsClaimedBy(ledger, sinkId);
  if (remaining <= 0) return;
  const startId = buildingAnchor(ctx.graph, sink);
  if (startId == null) return;
  const sourceType = def.source.type;
  const capacity = def.source.capacity;
  const buckets = bucketByAnchor(
    ctx.graph,
    ctx.buildings,
    (b) => b.type === sourceType && capacity - slotsGivenBy(ledger, b.id) > 0,
  );
  if (buckets.size === 0) return;
  const parents = bfsParents(ctx.graph, startId);
  walkBfsLayers(parents, startId, ctx.graph, (n) => {
    const list = buckets.get(n);
    if (!list) return false;
    for (const src of list) {
      if (remaining <= 0) return true;
      const slack = capacity - slotsGivenBy(ledger, src.id);
      if (slack <= 0) continue;
      const give = Math.min(slack, remaining);
      const sourceAnchorId = buildingAnchor(ctx.graph, src);
      if (sourceAnchorId == null) continue;
      // Path runs source→sink; parents map was built from sink, so reverse.
      const sinkToSource = pathEdgesFromParents(parents, sourceAnchorId);
      const edges = sinkToSource.slice().reverse();
      addAttribution(ledger, sinkId, src.id, give, sourceAnchorId, edges, ctx.traffic);
      remaining -= give;
    }
    return remaining <= 0;
  });
}

// Push slots from `sourceId` to closest under-allocated sinks of the right
// type, hop-by-hop, until source is full OR graph exhausted.
export function fillFromNewSource(sourceId: BuildingId, def: DemandDef, ctx: FillCtx): void {
  if (def.source.kind !== 'building') return;
  const ledger = ctx.ledgers.get(def.id)!;
  const source = ctx.buildings.find((b) => b.id === sourceId);
  if (!source) return;
  const capacity = def.source.capacity;
  let slack = capacity - slotsGivenBy(ledger, sourceId);
  if (slack <= 0) return;
  const startId = buildingAnchor(ctx.graph, source);
  if (startId == null) return;
  const sinkType = def.sink.type;
  const buckets = bucketByAnchor(
    ctx.graph,
    ctx.buildings,
    (b) => b.type === sinkType && sinkSlotDemand(b, def) - slotsClaimedBy(ledger, b.id) > 0,
  );
  if (buckets.size === 0) return;
  const parents = bfsParents(ctx.graph, startId);
  walkBfsLayers(parents, startId, ctx.graph, (n) => {
    const list = buckets.get(n);
    if (!list) return false;
    for (const sink of list) {
      if (slack <= 0) return true;
      const need = sinkSlotDemand(sink, def) - slotsClaimedBy(ledger, sink.id);
      if (need <= 0) continue;
      const give = Math.min(slack, need);
      const sinkAnchorId = buildingAnchor(ctx.graph, sink);
      if (sinkAnchorId == null) continue;
      const edges = pathEdgesFromParents(parents, sinkAnchorId);
      addAttribution(ledger, sink.id, sourceId, give, startId, edges, ctx.traffic);
      slack -= give;
    }
    return slack <= 0;
  });
}

export function settleNewBuilding(b: Building, ctx: FillCtx): void {
  for (const def of DEMAND_TYPES) {
    if (def.source.kind !== 'building') continue;
    if (b.type === def.sink.type) fillFromNewSink(b.id, def, ctx);
    if (b.type === def.source.type) fillFromNewSource(b.id, def, ctx);
  }
}

export function settleAfterDrop(dropped: DroppedLinks, ctx: FillCtx): void {
  for (const [demandId, sourceIds] of dropped.asSink) {
    const def = DEMAND_TYPES.find((d) => d.id === demandId);
    if (!def) continue;
    for (const sourceId of sourceIds) {
      if (!ctx.buildings.some((b) => b.id === sourceId)) continue;
      fillFromNewSource(sourceId, def, ctx);
    }
  }
  for (const [demandId, sinkIds] of dropped.asSource) {
    const def = DEMAND_TYPES.find((d) => d.id === demandId);
    if (!def) continue;
    for (const sinkId of sinkIds) {
      if (!ctx.buildings.some((b) => b.id === sinkId)) continue;
      fillFromNewSink(sinkId, def, ctx);
    }
  }
}
