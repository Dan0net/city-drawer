import type { Graph, EdgeId } from '@game/graph';
import type { DemandDef } from '@game/demand/types';
import type { DemandMap } from '@game/demand/maps';

interface SpawnPick {
  def: DemandDef;
  edgeId: EdgeId;
}

interface Candidate extends SpawnPick {
  weight: number;
}

// Single weighted pool over all demand × edge pairs. Edge score is the average
// of the demand's road-field at the two endpoints; pool weight is score × def.weight.
// Demands tune their relative spawn rates via `weight`; `threshold` gates each
// demand independently (e.g. shops only spawn where ≥10 houses' worth of
// commercial pressure has accumulated).
export function pickSpawn(
  graph: Graph,
  defs: ReadonlyArray<DemandDef>,
  maps: ReadonlyArray<DemandMap>,
  rand: () => number,
): SpawnPick | null {
  const candidates: Candidate[] = [];
  let total = 0;
  for (const def of defs) {
    const map = maps.find((m) => m.id === def.id);
    if (!map) continue;
    for (const e of graph.edges.values()) {
      const va = map.roadField.get(e.from) ?? 0;
      const vb = map.roadField.get(e.to) ?? 0;
      const score = (va + vb) * 0.5;
      if (score < def.threshold) continue;
      const w = score * def.weight;
      candidates.push({ def, edgeId: e.id, weight: w });
      total += w;
    }
  }
  if (total <= 0) return null;
  let r = rand() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return { def: c.def, edgeId: c.edgeId };
  }
  return candidates[candidates.length - 1];
}
