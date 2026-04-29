import type { Graph, NodeId } from '@game/graph';
import type { Building } from '@game/buildings';
import { DEMAND_TYPES, type DemandDef } from '@game/demand/types';
import type { DemandMap } from '@game/demand/maps';
import { clearCellsUnderPoly } from '@game/demand/cellMap';
import { ATTRIBUTION_NEAREST_RADIUS } from '@game/sim/config';

const filledOf = (b: Building, id: string): number => b.filled?.[id] ?? 0;

const bumpFilled = (b: Building, id: string, delta: number): void => {
  b.filled ??= {};
  const next = (b.filled[id] ?? 0) + delta;
  b.filled[id] = next < 0 ? 0 : next;
};

// Demand a given building type sinks. Each building type sinks at most one
// demand (KISS); undefined when the type only sources or never appears as a sink.
const demandSunkBy = (sinkType: Building['type']): DemandDef | undefined =>
  DEMAND_TYPES.find((d) => d.sink.type === sinkType);

// Up to `max` buildings (graph-distance from `center`) matching `filter`, in
// distance order. Multiple candidate buildings may share the same nearest node
// (e.g. a cluster of houses), so the per-node bucket is a list, not a single entry.
function nearestBuildings(
  graph: Graph,
  buildings: Building[],
  center: { x: number; y: number },
  filter: (b: Building) => boolean,
  max: number,
): Building[] {
  const out: Building[] = [];
  if (max <= 0) return out;
  const start = graph.nearestNode(center.x, center.y, ATTRIBUTION_NEAREST_RADIUS);
  if (!start) return out;
  const buckets = new Map<NodeId, Building[]>();
  for (const b of buildings) {
    if (!filter(b)) continue;
    const n = graph.nearestNode(b.centroid.x, b.centroid.y, ATTRIBUTION_NEAREST_RADIUS);
    if (!n) continue;
    const list = buckets.get(n.id);
    if (list) list.push(b);
    else buckets.set(n.id, [b]);
  }
  if (buckets.size === 0) return out;
  const visited = new Set<NodeId>([start.id]);
  const queue: NodeId[] = [start.id];
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

// Attribute `sink` to up to `def.sink.count` nearby sources with slack and
// increment each source's filled count for this demand. For cell-sourced
// demands, clears cells under the sink's polygon instead (e.g. a factory
// consumes the resource it sits on). Mutates `sink`, source buildings, and
// the demand map's cells.
export function applyAttribution(
  sink: Building,
  def: DemandDef,
  map: DemandMap,
  graph: Graph,
  buildings: Building[],
): void {
  if (def.source.kind === 'cells') {
    clearCellsUnderPoly(map.cellMap, sink.poly, sink.aabb);
    return;
  }
  const sourceType = def.source.type;
  const capacity = def.source.capacity;
  const sources = nearestBuildings(
    graph,
    buildings,
    sink.centroid,
    (b) => b.type === sourceType && filledOf(b, def.id) < capacity,
    def.sink.count,
  );
  if (sources.length === 0) return;
  sink.attributedToIds = sources.map((s) => s.id);
  for (const s of sources) bumpFilled(s, def.id, +1);
}

// Reverse of applyAttribution. Looks up the demand the sink is for via its
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
