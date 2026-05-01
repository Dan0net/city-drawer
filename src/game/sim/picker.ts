import type { EdgeId, Graph, NodeId } from '@game/graph';
import type { Building } from '@game/buildings';
import type { DemandDef } from '@game/demand/types';
import { DEMAND_TYPES } from '@game/demand/types';
import type { DemandMap } from '@game/demand/maps';
import { sinkSlotDemand, type AttributionLedgers } from './attribution';
import { EXP_DEMAND, EXP_LOCATION } from './config';

// Weighted roulette over arbitrary items. Returns null when total weight ≤ 0.
function weightedPick<T>(
  items: ReadonlyArray<T>,
  weight: (t: T) => number,
  rand: () => number,
): T | null {
  let total = 0;
  for (const it of items) total += weight(it);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

interface AvailStat {
  cap: number;
  filled: number;
  avail: number;
}

// Layer 1 truth — global cap/filled/avail for a demand. Source of truth for
// the demand-roll dice and the Demand tab.
//
// Building-sourced: cap = nSources × source.capacity; filled = ledger.totalSlots.
// Cell-sourced: cap = floor(map.reachableSum / unitArea); filled = Σ
//   sinkSlotDemand(b, def) across sink-type buildings.
// avail is non-negative by construction in both cases (the building-sourced
// invariant is maintained by the fill helpers, which never overshoot capacity).
export function globalAvail(
  def: DemandDef,
  buildings: Building[],
  demandMaps: ReadonlyArray<DemandMap>,
  ledgers: AttributionLedgers,
): AvailStat {
  if (def.source.kind === 'building') {
    const sourceType = def.source.type;
    const capacity = def.source.capacity;
    let cap = 0;
    for (const b of buildings) if (b.type === sourceType) cap += capacity;
    const filled = ledgers.get(def.id)?.totalSlots ?? 0;
    return { cap, filled, avail: Math.max(0, cap - filled) };
  }
  const map = demandMaps.find((m) => m.id === def.id);
  const unit = def.unitArea ?? 1;
  const cap = Math.floor((map?.reachableSum ?? 0) / unit);
  let filled = 0;
  for (const b of buildings) {
    if (b.type === def.sink.type) filled += sinkSlotDemand(b, def);
  }
  return { cap, filled, avail: Math.max(0, cap - filled) };
}

// Stage 1: pick which demand fires this tick. Skips demands with avail ≤ 0.
// Weight = avail^EXP.
export function pickDemand(
  buildings: Building[],
  demandMaps: ReadonlyArray<DemandMap>,
  ledgers: AttributionLedgers,
  rand: () => number,
): DemandDef | null {
  return weightedPick(DEMAND_TYPES, (d) => {
    const a = globalAvail(d, buildings, demandMaps, ledgers).avail;
    return a > 0 ? Math.pow(a, EXP_DEMAND) : 0;
  }, rand);
}

const edgeScore = (map: DemandMap | undefined, fromId: NodeId, toId: NodeId): number => {
  if (!map) return 0;
  const va = map.roadField.get(fromId) ?? 0;
  const vb = map.roadField.get(toId) ?? 0;
  return (va + vb) * 0.5;
};

// Stage 2: pick which edge for the chosen demand. Weight = field^EXP. If the
// field is zero on every edge (no source reachable anywhere), falls back to
// uniform over all edges so a sink still spawns somewhere — global accounting
// stays accurate; placement just won't be near supply.
export function pickEdgeForDemand(
  graph: Graph,
  def: DemandDef,
  demandMaps: ReadonlyArray<DemandMap>,
  rand: () => number,
): EdgeId | null {
  const map = demandMaps.find((m) => m.id === def.id);
  const edges = [...graph.edges.values()];
  if (edges.length === 0) return null;
  const weighted = weightedPick(edges, (e) => Math.pow(edgeScore(map, e.from, e.to), EXP_LOCATION), rand);
  if (weighted) return weighted.id;
  return edges[Math.floor(rand() * edges.length)].id;
}

interface FieldRow {
  nodeId: NodeId;
  values: Record<string, number>;
  max: number;
}

// Per-node × per-demand snapshot for the Field tab. Sorted by max-across-
// demands desc so hotspots float to the top.
export function previewField(
  graph: Graph,
  defs: ReadonlyArray<DemandDef>,
  demandMaps: ReadonlyArray<DemandMap>,
): FieldRow[] {
  const out: FieldRow[] = [];
  for (const node of graph.nodes.values()) {
    const values: Record<string, number> = {};
    let max = 0;
    for (const def of defs) {
      const map = demandMaps.find((m) => m.id === def.id);
      const v = map?.roadField.get(node.id) ?? 0;
      values[def.id] = v;
      if (v > max) max = v;
    }
    if (max > 0) out.push({ nodeId: node.id, values, max });
  }
  return out.sort((a, b) => b.max - a.max);
}
