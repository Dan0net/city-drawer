import type { EdgeId, Graph, GraphDelta } from '@game/graph';
import type { Building } from '@game/buildings';
import { removeBuildingRestoring } from '@game/buildings/bulldoze';
import {
  dropLinksThroughEdges,
  fillFromNewSink,
  fillFromNewSource,
  settleAfterDrop,
  sinkSlotDemand,
  slotsClaimedBy,
  slotsGivenBy,
  type AttributionLedgers,
  type TrafficState,
} from '@game/sim/attribution';
import { DEMAND_TYPES } from '@game/demand/types';

// Apply a GraphDelta to ledger + traffic + buildings. Single funnel for any
// graph mutation that destroyed an edge id (split or outright delete).
//
// Steps in order:
//  1. Remap `Building.consumed` for buildings on a parent that got split,
//     so their primary face still points at a real edge.
//  2. Drop ledger links whose stored path went through any dead edge id;
//     re-fill counterparties on the new graph.
//  3. Bulldoze any buildings whose primary face was on a deleted (not split)
//     edge — there's no child to remap to.
export function reconcileGraphDelta(
  delta: GraphDelta,
  graph: Graph,
  buildings: Building[],
  ledgers: AttributionLedgers,
  traffic: TrafficState,
): { buildingsTouched: boolean } {
  let buildingsTouched = false;

  if (delta.splits.size > 0) {
    for (const b of buildings) {
      for (let i = 0; i < b.consumed.length; i++) {
        const c = b.consumed[i];
        const children = delta.splits.get(c.edgeId);
        if (!children) continue;
        const mid = (c.t0 + c.t1) * 0.5;
        const child = children.find((ch) => mid >= ch.parentT0 && mid <= ch.parentT1)
          ?? children[0];
        const span = child.parentT1 - child.parentT0;
        if (span <= 0) continue;
        const lo = Math.max(c.t0, child.parentT0);
        const hi = Math.min(c.t1, child.parentT1);
        b.consumed[i] = {
          edgeId: child.id,
          side: c.side,
          t0: Math.max(0, (lo - child.parentT0) / span),
          t1: Math.min(1, (hi - child.parentT0) / span),
        };
        buildingsTouched = true;
      }
    }
  }

  const dead = new Set<EdgeId>(delta.deletedEdges);
  for (const parentId of delta.splits.keys()) dead.add(parentId);
  if (dead.size > 0) {
    const dropped = dropLinksThroughEdges(ledgers, dead, traffic);
    settleAfterDrop(dropped, { graph, buildings, ledgers, traffic });
  }

  if (delta.deletedEdges.length > 0) {
    const deletedSet = new Set(delta.deletedEdges);
    for (let i = buildings.length - 1; i >= 0; i--) {
      const primary = buildings[i].consumed[0]?.edgeId;
      if (primary != null && deletedSet.has(primary)) {
        removeBuildingRestoring(graph, buildings, ledgers, traffic, buildings[i].id, deletedSet);
        buildingsTouched = true;
      }
    }
  }

  return { buildingsTouched };
}

// New edges create new fill opportunities for under-allocated buildings.
// Mirrors the deletion path's automatic reroute. Idempotent — fill helpers
// short-circuit on already-full buildings, so blanket-iterating is cheap.
export function reconcileGraphAdditions(
  graph: Graph,
  buildings: Building[],
  ledgers: AttributionLedgers,
  traffic: TrafficState,
): void {
  const ctx = { graph, buildings, ledgers, traffic };
  for (const def of DEMAND_TYPES) {
    if (def.source.kind !== 'building') continue;
    const ledger = ledgers.get(def.id);
    if (!ledger) continue;
    const cap = def.source.capacity;
    const sourceType = def.source.type;
    const sinkType = def.sink.type;
    for (const b of buildings) {
      if (b.type === sinkType && slotsClaimedBy(ledger, b.id) < sinkSlotDemand(b, def)) {
        fillFromNewSink(b.id, def, ctx);
      }
      if (b.type === sourceType && slotsGivenBy(ledger, b.id) < cap) {
        fillFromNewSource(b.id, def, ctx);
      }
    }
  }
}
