import type { Graph, EdgeId } from '@game/graph';
import type { DemandDef } from '@game/demand/types';
import type { DemandMap } from '@game/demand/maps';

interface SpawnPick {
  def: DemandDef;
  edgeId: EdgeId;
}

interface PoolCandidate extends SpawnPick {
  score: number;  // raw road-field value
  weight: number; // score × def.weight (roulette weight)
}

// Build the spawn pool: every (demand, edge) pair where the demand's road
// field at the edge midpoint clears its threshold. Pool weight is
// score × def.weight.
function buildPool(
  graph: Graph,
  defs: ReadonlyArray<DemandDef>,
  maps: ReadonlyArray<DemandMap>,
): PoolCandidate[] {
  const out: PoolCandidate[] = [];
  for (const def of defs) {
    const map = maps.find((m) => m.id === def.id);
    if (!map) continue;
    for (const e of graph.edges.values()) {
      const va = map.roadField.get(e.from) ?? 0;
      const vb = map.roadField.get(e.to) ?? 0;
      const score = (va + vb) * 0.5;
      if (score < def.threshold) continue;
      out.push({ def, edgeId: e.id, score, weight: score * def.weight });
    }
  }
  return out;
}

// Single weighted pool over all demand × edge pairs. Demands tune their
// relative spawn rates via `weight`; `threshold` gates each demand
// independently (e.g. shops only spawn where ≥10 houses' worth of
// commercial pressure has accumulated).
export function pickSpawn(
  graph: Graph,
  defs: ReadonlyArray<DemandDef>,
  maps: ReadonlyArray<DemandMap>,
  rand: () => number,
): SpawnPick | null {
  const candidates = buildPool(graph, defs, maps);
  let total = 0;
  for (const c of candidates) total += c.weight;
  if (total <= 0) return null;
  let r = rand() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return { def: c.def, edgeId: c.edgeId };
  }
  return candidates[candidates.length - 1];
}

// Snapshot of the current pool, sorted by descending weight. For debug UIs.
export function previewPool(
  graph: Graph,
  defs: ReadonlyArray<DemandDef>,
  maps: ReadonlyArray<DemandMap>,
): PoolCandidate[] {
  return buildPool(graph, defs, maps).sort((a, b) => b.weight - a.weight);
}
