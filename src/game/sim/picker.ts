import type { EdgeId, Graph, NodeId } from '@game/graph';
import type { Building } from '@game/buildings';
import type { DemandDef } from '@game/demand/types';
import { DEMAND_TYPES } from '@game/demand/types';
import type { DemandMap } from '@game/demand/maps';
import { perSinkConsumption } from './attribution';
import { EXP_DEMAND, EXP_LOCATION } from './config';

// Weighted roulette over arbitrary items. Returns null when total weight ≤ 0.
// Single roulette implementation in the codebase — both pick stages use it.
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
// Building-sourced: cap = nSources × source.capacity; filled = Σ filled[id]
//   across sources; avail = cap − filled.
// Cell-sourced: cap = map.reachableSum (Σ cell-value × cellArea, each cell
//   counted at most once across all node discs — see reachableCellSum in
//   demand/compute.ts); filled = nSinks × (consumption ?? 1); avail can go
//   negative if roads were bulldozed below the level needed to sustain
//   already-built sinks; not clamped — caller decides display.
export function globalAvail(
  def: DemandDef,
  buildings: Building[],
  demandMaps: ReadonlyArray<DemandMap>,
): AvailStat {
  if (def.source.kind === 'building') {
    const sourceType = def.source.type;
    const capacity = def.source.capacity;
    let cap = 0;
    let filled = 0;
    for (const b of buildings) {
      if (b.type !== sourceType) continue;
      cap += capacity;
      filled += b.filled?.[def.id] ?? 0;
    }
    return { cap, filled, avail: cap - filled };
  }
  const map = demandMaps.find((m) => m.id === def.id);
  const unit = def.unitArea ?? 1;
  const cap = Math.floor((map?.reachableSum ?? 0) / unit);
  let filled = 0;
  for (const b of buildings) {
    if (b.type === def.sink.type) filled += perSinkConsumption(b, def, 1);
  }
  return { cap, filled, avail: cap - filled };
}

// Stage 1: pick which demand fires this tick. Excludes demands in `excluded`
// (already tried + failed routing) and any with avail ≤ 0. Weight = avail^EXP.
export function pickDemand(
  buildings: Building[],
  demandMaps: ReadonlyArray<DemandMap>,
  excluded: ReadonlySet<string>,
  rand: () => number,
): DemandDef | null {
  const candidates = DEMAND_TYPES.filter((d) => !excluded.has(d.id));
  return weightedPick(candidates, (d) => {
    const a = globalAvail(d, buildings, demandMaps).avail;
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
  // Uniform fallback.
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
