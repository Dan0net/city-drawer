import type { Graph, NodeId } from '@game/graph';
import type { Building } from '@game/buildings';
import { DEMAND_TYPES, type DemandDef } from '@game/demand/types';
import { ATTRIBUTION_NEAREST_RADIUS } from '@game/sim/config';

const filledOf = (b: Building, id: string): number => b.filled?.[id] ?? 0;

const bumpFilled = (b: Building, id: string, delta: number): void => {
  b.filled ??= {};
  const next = (b.filled[id] ?? 0) + delta;
  b.filled[id] = next < 0 ? 0 : next;
};

const demandSunkBy = (sinkType: Building['type']): DemandDef | undefined =>
  DEMAND_TYPES.find((d) => d.sink.type === sinkType);

// Find up to `def.sink.count` source-type buildings with slack, reachable via
// graph BFS from the sink's nearest node. Empty array means no route.
// Pure read — does not mutate. Only meaningful for building-sourced demands;
// callers gate on `def.source.kind === 'building'`.
//
// Takes a bare centroid (not a full Building) so it can run before the sink
// has been allocated a building id.
export function findSources(
  sink: { centroid: { x: number; y: number } },
  def: DemandDef,
  graph: Graph,
  buildings: Building[],
): Building[] {
  const out: Building[] = [];
  if (def.source.kind !== 'building' || def.sink.count <= 0) return out;
  const start = graph.nearestNode(sink.centroid.x, sink.centroid.y, ATTRIBUTION_NEAREST_RADIUS);
  if (!start) return out;
  const sourceType = def.source.type;
  const capacity = def.source.capacity;
  // Bucket source-type buildings with slack by their nearest road node.
  const buckets = new Map<NodeId, Building[]>();
  for (const b of buildings) {
    if (b.type !== sourceType) continue;
    if (filledOf(b, def.id) >= capacity) continue;
    const n = graph.nearestNode(b.centroid.x, b.centroid.y, ATTRIBUTION_NEAREST_RADIUS);
    if (!n) continue;
    const list = buckets.get(n.id);
    if (list) list.push(b);
    else buckets.set(n.id, [b]);
  }
  if (buckets.size === 0) return out;
  // BFS by hop count from the sink's nearest node.
  const visited = new Set<NodeId>([start.id]);
  const queue: NodeId[] = [start.id];
  const max = def.sink.count;
  while (queue.length > 0 && out.length < max) {
    const n = queue.shift()!;
    const list = buckets.get(n);
    if (list) {
      for (const b of list) {
        out.push(b);
        if (out.length >= max) return out;
      }
    }
    const node = graph.nodes.get(n);
    if (!node) continue;
    for (const eid of node.edges) {
      const e = graph.edges.get(eid);
      if (!e) continue;
      const other = e.from === n ? e.to : e.from;
      if (!visited.has(other)) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  return out;
}

// Mutate sink + sources to record the attribution. Caller has already decided
// to commit (sources non-empty for building-sourced; cells just no-op).
export function commitAttribution(sink: Building, def: DemandDef, sources: Building[]): void {
  if (def.source.kind !== 'building' || sources.length === 0) return;
  sink.attributedToIds = sources.map((s) => s.id);
  for (const s of sources) bumpFilled(s, def.id, +1);
}

// Reverse of commitAttribution. Looks up the demand the sink is for via its
// type, then decrements each attributed source's filled count.
export function undoAttribution(sink: Building, buildings: Building[]): void {
  if (!sink.attributedToIds || sink.attributedToIds.length === 0) return;
  const def = demandSunkBy(sink.type);
  if (!def || def.source.kind !== 'building') return;
  for (const id of sink.attributedToIds) {
    const target = buildings.find((b) => b.id === id);
    if (!target) continue;
    bumpFilled(target, def.id, -1);
  }
}
