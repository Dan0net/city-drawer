import type { Graph, NodeId } from '@game/graph';
import type { Building, BuildingId } from '@game/buildings';
import { DEMAND_TYPES, type DemandDef, type DemandId } from '@game/demand/types';
import { ATTRIBUTION_NEAREST_RADIUS } from '@game/sim/config';

// Per-demand bidirectional attribution map. Source of truth for who is
// connected to whom and how many slots flow on that edge. `Building.filled`
// no longer exists — read source slack via `slotsGivenBy` and global filled
// via `totalSlots`.
export interface AttributionLedger {
  bySink: Map<BuildingId, Map<BuildingId, number>>;
  bySource: Map<BuildingId, Map<BuildingId, number>>;
  totalSlots: number;
}

export type AttributionLedgers = Map<DemandId, AttributionLedger>;

export function createAttributionLedgers(): AttributionLedgers {
  const m: AttributionLedgers = new Map();
  for (const def of DEMAND_TYPES) {
    m.set(def.id, { bySink: new Map(), bySource: new Map(), totalSlots: 0 });
  }
  return m;
}

const bump = (m: Map<BuildingId, Map<BuildingId, number>>, k: BuildingId, k2: BuildingId, d: number): void => {
  let inner = m.get(k);
  if (!inner) {
    if (d <= 0) return;
    inner = new Map();
    m.set(k, inner);
  }
  const next = (inner.get(k2) ?? 0) + d;
  if (next <= 0) {
    inner.delete(k2);
    if (inner.size === 0) m.delete(k);
  } else {
    inner.set(k2, next);
  }
};

const addAttribution = (
  ledger: AttributionLedger,
  sinkId: BuildingId,
  sourceId: BuildingId,
  slots: number,
): void => {
  if (slots <= 0) return;
  bump(ledger.bySink, sinkId, sourceId, slots);
  bump(ledger.bySource, sourceId, sinkId, slots);
  ledger.totalSlots += slots;
};

export const slotsGivenBy = (ledger: AttributionLedger, sourceId: BuildingId): number => {
  const inner = ledger.bySource.get(sourceId);
  if (!inner) return 0;
  let s = 0;
  for (const v of inner.values()) s += v;
  return s;
};

export const slotsClaimedBy = (ledger: AttributionLedger, sinkId: BuildingId): number => {
  const inner = ledger.bySink.get(sinkId);
  if (!inner) return 0;
  let s = 0;
  for (const v of inner.values()) s += v;
  return s;
};

// Total slots a sink wants for a demand, independent of how many sources
// supply it. Clamped ≥ 1 so tiny post-shrink sinks still demand something.
export const sinkSlotDemand = (sink: Building, def: DemandDef): number => {
  const unit = def.unitArea ?? 1;
  const mult = def.sink.consumption ?? 1;
  return Math.max(1, Math.floor(sink.area / unit)) * mult;
};

// Drop every ledger entry that touches `id` (in either role) and return the
// list of counterparties whose links were just removed, so callers can run
// fill helpers on them. Pure subtraction; no fill or rebalance happens here.
export interface DroppedLinks {
  // Demands where this id had been a sink → list of source ids whose slack just grew.
  asSink: Map<DemandId, BuildingId[]>;
  // Demands where this id had been a source → list of sink ids that just lost slots.
  asSource: Map<DemandId, BuildingId[]>;
}

export function dropFromLedgers(
  ledgers: AttributionLedgers,
  id: BuildingId,
): DroppedLinks {
  const asSink = new Map<DemandId, BuildingId[]>();
  const asSource = new Map<DemandId, BuildingId[]>();
  for (const [demandId, ledger] of ledgers) {
    const sinkLinks = ledger.bySink.get(id);
    if (sinkLinks && sinkLinks.size > 0) {
      const sources: BuildingId[] = [];
      for (const [sourceId, slots] of sinkLinks) {
        sources.push(sourceId);
        ledger.totalSlots -= slots;
        const inv = ledger.bySource.get(sourceId);
        if (inv) {
          inv.delete(id);
          if (inv.size === 0) ledger.bySource.delete(sourceId);
        }
      }
      ledger.bySink.delete(id);
      asSink.set(demandId, sources);
    }
    const sourceLinks = ledger.bySource.get(id);
    if (sourceLinks && sourceLinks.size > 0) {
      const sinks: BuildingId[] = [];
      for (const [sinkId, slots] of sourceLinks) {
        sinks.push(sinkId);
        ledger.totalSlots -= slots;
        const inv = ledger.bySink.get(sinkId);
        if (inv) {
          inv.delete(id);
          if (inv.size === 0) ledger.bySink.delete(sinkId);
        }
      }
      ledger.bySource.delete(id);
      asSource.set(demandId, sinks);
    }
  }
  return { asSink, asSource };
}

// Walk the graph BFS by hop count from `startNodeId`, calling `visit` on each
// reached node. Stops when `visit` returns true. Single canonical pattern;
// callers wrap their per-node logic in the closure.
function bfsHops(graph: Graph, startNodeId: NodeId, visit: (n: NodeId) => boolean): void {
  const visited = new Set<NodeId>([startNodeId]);
  const queue: NodeId[] = [startNodeId];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (visit(n)) return;
    const node = graph.nodes.get(n);
    if (!node) continue;
    for (const eid of node.edges) {
      const e = graph.edges.get(eid);
      if (!e) continue;
      const other = e.from === n ? e.to : e.from;
      if (visited.has(other)) continue;
      visited.add(other);
      queue.push(other);
    }
  }
}

interface FillCtx {
  graph: Graph;
  buildings: Building[];
  ledgers: AttributionLedgers;
}

// Anchor a building's nearest road node, bucketing other buildings by node id.
const bucketByNearestNode = (
  graph: Graph,
  buildings: Building[],
  predicate: (b: Building) => boolean,
): Map<NodeId, Building[]> => {
  const buckets = new Map<NodeId, Building[]>();
  for (const b of buildings) {
    if (!predicate(b)) continue;
    const n = graph.nearestNode(b.centroid.x, b.centroid.y, ATTRIBUTION_NEAREST_RADIUS);
    if (!n) continue;
    const list = buckets.get(n.id);
    if (list) list.push(b);
    else buckets.set(n.id, [b]);
  }
  return buckets;
};

// Pull slots into `sinkId` from closest source-with-slack, hop-by-hop, until
// the sink's demand is satisfied OR the graph is exhausted. Partial fill OK.
export function fillFromNewSink(sinkId: BuildingId, def: DemandDef, ctx: FillCtx): void {
  if (def.source.kind !== 'building') return;
  const ledger = ctx.ledgers.get(def.id)!;
  const sink = ctx.buildings.find((b) => b.id === sinkId);
  if (!sink) return;
  let remaining = sinkSlotDemand(sink, def) - slotsClaimedBy(ledger, sinkId);
  if (remaining <= 0) return;
  const start = ctx.graph.nearestNode(sink.centroid.x, sink.centroid.y, ATTRIBUTION_NEAREST_RADIUS);
  if (!start) return;
  const sourceType = def.source.type;
  const capacity = def.source.capacity;
  const buckets = bucketByNearestNode(
    ctx.graph,
    ctx.buildings,
    (b) => b.type === sourceType && capacity - slotsGivenBy(ledger, b.id) > 0,
  );
  if (buckets.size === 0) return;
  bfsHops(ctx.graph, start.id, (n) => {
    const list = buckets.get(n);
    if (!list) return false;
    for (const src of list) {
      if (remaining <= 0) return true;
      const slack = capacity - slotsGivenBy(ledger, src.id);
      if (slack <= 0) continue;
      const give = Math.min(slack, remaining);
      addAttribution(ledger, sinkId, src.id, give);
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
  const start = ctx.graph.nearestNode(source.centroid.x, source.centroid.y, ATTRIBUTION_NEAREST_RADIUS);
  if (!start) return;
  const sinkType = def.sink.type;
  const buckets = bucketByNearestNode(
    ctx.graph,
    ctx.buildings,
    (b) => b.type === sinkType && sinkSlotDemand(b, def) - slotsClaimedBy(ledger, b.id) > 0,
  );
  if (buckets.size === 0) return;
  bfsHops(ctx.graph, start.id, (n) => {
    const list = buckets.get(n);
    if (!list) return false;
    for (const sink of list) {
      if (slack <= 0) return true;
      const need = sinkSlotDemand(sink, def) - slotsClaimedBy(ledger, sink.id);
      if (need <= 0) continue;
      const give = Math.min(slack, need);
      addAttribution(ledger, sink.id, sourceId, give);
      slack -= give;
    }
    return slack <= 0;
  });
}

// Convenience: place a freshly-spawned building into the ledger by calling
// the right fill helper for each demand it touches.
export function settleNewBuilding(b: Building, ctx: FillCtx): void {
  for (const def of DEMAND_TYPES) {
    if (def.source.kind !== 'building') continue;
    if (b.type === def.sink.type) fillFromNewSink(b.id, def, ctx);
    if (b.type === def.source.type) fillFromNewSource(b.id, def, ctx);
  }
}

// Re-fill counterparties whose links were just dropped (sink → fillFromNewSink
// for the sink, source → fillFromNewSource for the source). Skips ids that
// have already been removed from `buildings`.
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
