import type { Graph, NodeId } from './';

// Shortest-hop path between two graph nodes. Returns [] when unreachable or
// either id is missing. Single canonical BFS-with-parents in the codebase.
export function bfsPath(graph: Graph, fromId: NodeId, toId: NodeId): NodeId[] {
  if (fromId === toId) return graph.nodes.has(fromId) ? [fromId] : [];
  if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) return [];
  const parent = new Map<NodeId, NodeId>();
  parent.set(fromId, fromId);
  const queue: NodeId[] = [fromId];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n === toId) break;
    const node = graph.nodes.get(n);
    if (!node) continue;
    for (const eid of node.edges) {
      const e = graph.edges.get(eid);
      if (!e) continue;
      const other = e.from === n ? e.to : e.from;
      if (parent.has(other)) continue;
      parent.set(other, n);
      queue.push(other);
    }
  }
  if (!parent.has(toId)) return [];
  const out: NodeId[] = [];
  let cur = toId;
  while (cur !== fromId) {
    out.push(cur);
    cur = parent.get(cur)!;
  }
  out.push(fromId);
  out.reverse();
  return out;
}
