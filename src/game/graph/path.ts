import type { EdgeId, Graph, NodeId } from './';

export interface BfsParent {
  parent: NodeId;
  edge: EdgeId;
}

// BFS-with-parents from `fromId`. Each non-start entry records the edge used
// to reach that node, so callers can walk back collecting either node ids
// (bfsPath) or edge ids (traffic accumulation, hover route reconstruction).
// The start node is its own parent with edge = -1.
export function bfsParents(graph: Graph, fromId: NodeId): Map<NodeId, BfsParent> {
  const parent = new Map<NodeId, BfsParent>();
  if (!graph.nodes.has(fromId)) return parent;
  parent.set(fromId, { parent: fromId, edge: -1 });
  const queue: NodeId[] = [fromId];
  while (queue.length > 0) {
    const n = queue.shift()!;
    const node = graph.nodes.get(n);
    if (!node) continue;
    for (const eid of node.edges) {
      const e = graph.edges.get(eid);
      if (!e) continue;
      const other = e.from === n ? e.to : e.from;
      if (parent.has(other)) continue;
      parent.set(other, { parent: n, edge: eid });
      queue.push(other);
    }
  }
  return parent;
}

// Shortest-hop node path from→to. Empty when unreachable.
export function bfsPath(graph: Graph, fromId: NodeId, toId: NodeId): NodeId[] {
  if (fromId === toId) return graph.nodes.has(fromId) ? [fromId] : [];
  const parents = bfsParents(graph, fromId);
  if (!parents.has(toId)) return [];
  const out: NodeId[] = [];
  let cur = toId;
  while (cur !== fromId) {
    out.push(cur);
    cur = parents.get(cur)!.parent;
  }
  out.push(fromId);
  out.reverse();
  return out;
}

// Walk parents from `targetId` back to the start, collecting edge ids in
// source→target order. Empty when target is unreachable from start.
export function pathEdgesFromParents(
  parents: Map<NodeId, BfsParent>,
  targetId: NodeId,
): EdgeId[] {
  const out: EdgeId[] = [];
  if (!parents.has(targetId)) return out;
  let cur = targetId;
  while (true) {
    const p = parents.get(cur)!;
    if (p.edge < 0) break;
    out.push(p.edge);
    cur = p.parent;
  }
  out.reverse();
  return out;
}
