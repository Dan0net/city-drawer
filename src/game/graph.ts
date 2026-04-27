import { clamp } from '@lib/math';

export type NodeId = number;
export type EdgeId = number;
export type EdgeKind = 'road' | 'path';

export interface GraphNode {
  id: NodeId;
  x: number;
  y: number;
  edges: Set<EdgeId>;
}

export interface GraphEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
}

export type Anchor =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'node'; nodeId: NodeId }
  | { kind: 'split'; edgeId: EdgeId; t: number };

const CELL = 16;
const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;

export class Graph {
  readonly nodes = new Map<NodeId, GraphNode>();
  readonly edges = new Map<EdgeId, GraphEdge>();
  // Bumped on every mutation. Renderer compares to last seen to know when to rebuild.
  version = 0;

  private nextNodeId = 1;
  private nextEdgeId = 1;
  private edgeCells = new Map<EdgeId, string[]>();
  private edgeGrid = new Map<string, Set<EdgeId>>();
  private nodeGrid = new Map<string, Set<NodeId>>();

  insertEdge(
    a: Anchor,
    b: Anchor,
    kind: EdgeKind,
  ): { edgeId: EdgeId; fromId: NodeId; toId: NodeId } | null {
    // Early dedup for node→node so we don't accidentally create an orphan node
    // via a 'free'-anchor resolve that we'd then have to roll back.
    if (a.kind === 'node' && b.kind === 'node') {
      if (a.nodeId === b.nodeId) return null;
      const dup = this.findEdgeBetween(a.nodeId, b.nodeId);
      if (dup != null) return { edgeId: dup, fromId: a.nodeId, toId: b.nodeId };
    }

    const aId = this.resolveAnchor(a);
    const bId = this.resolveAnchor(b);
    if (aId === bId) return null;

    const existing = this.findEdgeBetween(aId, bId);
    if (existing != null) {
      return { edgeId: existing, fromId: aId, toId: bId };
    }

    const id = this.nextEdgeId++;
    const edge: GraphEdge = { id, from: aId, to: bId, kind };
    this.edges.set(id, edge);
    this.nodes.get(aId)!.edges.add(id);
    this.nodes.get(bId)!.edges.add(id);
    this.indexEdge(edge);
    this.version++;
    return { edgeId: id, fromId: aId, toId: bId };
  }

  removeEdge(id: EdgeId): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;
    this.unindexEdge(edge);
    this.edges.delete(id);
    const from = this.nodes.get(edge.from)!;
    const to = this.nodes.get(edge.to)!;
    from.edges.delete(id);
    to.edges.delete(id);
    if (from.edges.size === 0) {
      this.unindexNode(from);
      this.nodes.delete(from.id);
    }
    if (to.edges.size === 0 && to.id !== from.id) {
      this.unindexNode(to);
      this.nodes.delete(to.id);
    }
    this.version++;
    return true;
  }

  // Remove a node and any edges touching it.
  removeNode(id: NodeId): boolean {
    const n = this.nodes.get(id);
    if (!n) return false;
    for (const eid of [...n.edges]) this.removeEdge(eid);
    // removeEdge already prunes the orphan node, but if it had no edges to start with:
    if (this.nodes.has(id)) {
      this.unindexNode(this.nodes.get(id)!);
      this.nodes.delete(id);
      this.version++;
    }
    return true;
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.edgeCells.clear();
    this.edgeGrid.clear();
    this.nodeGrid.clear();
    this.version++;
  }

  // Nearest node within a world-radius. Returns null if none.
  nearestNode(x: number, y: number, radius: number): GraphNode | null {
    const r2 = radius * radius;
    const c0 = Math.floor((x - radius) / CELL);
    const c1 = Math.floor((x + radius) / CELL);
    const r0 = Math.floor((y - radius) / CELL);
    const r1 = Math.floor((y + radius) / CELL);
    let best: GraphNode | null = null;
    let bestD2 = Infinity;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const set = this.nodeGrid.get(cellKey(cx, cy));
        if (!set) continue;
        for (const nid of set) {
          const n = this.nodes.get(nid)!;
          const dx = n.x - x;
          const dy = n.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && d2 < bestD2) {
            best = n;
            bestD2 = d2;
          }
        }
      }
    }
    return best;
  }

  // Nearest edge within a world-radius. Returns null if none.
  nearestEdge(
    x: number,
    y: number,
    radius: number,
  ): { edge: GraphEdge; t: number; px: number; py: number } | null {
    const r2 = radius * radius;
    const c0 = Math.floor((x - radius) / CELL);
    const c1 = Math.floor((x + radius) / CELL);
    const r0 = Math.floor((y - radius) / CELL);
    const r1 = Math.floor((y + radius) / CELL);
    const seen = new Set<EdgeId>();
    let best: { edge: GraphEdge; t: number; px: number; py: number } | null = null;
    let bestD2 = Infinity;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const set = this.edgeGrid.get(cellKey(cx, cy));
        if (!set) continue;
        for (const eid of set) {
          if (seen.has(eid)) continue;
          seen.add(eid);
          const e = this.edges.get(eid)!;
          const a = this.nodes.get(e.from)!;
          const b = this.nodes.get(e.to)!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          if (len2 === 0) continue;
          let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
          t = clamp(t, 0, 1);
          const px = a.x + dx * t;
          const py = a.y + dy * t;
          const ddx = x - px;
          const ddy = y - py;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 <= r2 && d2 < bestD2) {
            best = { edge: e, t, px, py };
            bestD2 = d2;
          }
        }
      }
    }
    return best;
  }

  // ---------- private ----------

  private resolveAnchor(a: Anchor): NodeId {
    if (a.kind === 'node') return a.nodeId;
    if (a.kind === 'free') return this.addNode(a.x, a.y);
    return this.splitEdge(a.edgeId, a.t);
  }

  private addNode(x: number, y: number): NodeId {
    const id = this.nextNodeId++;
    const node: GraphNode = { id, x, y, edges: new Set() };
    this.nodes.set(id, node);
    this.indexNode(node);
    return id;
  }

  private splitEdge(edgeId: EdgeId, t: number): NodeId {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`splitEdge: edge ${edgeId} not found`);
    const from = this.nodes.get(edge.from)!;
    const to = this.nodes.get(edge.to)!;
    // Clamp t away from exact endpoints so splits don't produce zero-length edges
    const ts = clamp(t, 0.0001, 0.9999);
    const x = from.x + (to.x - from.x) * ts;
    const y = from.y + (to.y - from.y) * ts;

    const newId = this.addNode(x, y);
    const newNode = this.nodes.get(newId)!;

    this.unindexEdge(edge);
    this.edges.delete(edgeId);
    from.edges.delete(edgeId);
    to.edges.delete(edgeId);

    const e1Id = this.nextEdgeId++;
    const e2Id = this.nextEdgeId++;
    const e1: GraphEdge = { id: e1Id, from: edge.from, to: newId, kind: edge.kind };
    const e2: GraphEdge = { id: e2Id, from: newId, to: edge.to, kind: edge.kind };
    this.edges.set(e1Id, e1);
    this.edges.set(e2Id, e2);
    from.edges.add(e1Id);
    newNode.edges.add(e1Id);
    newNode.edges.add(e2Id);
    to.edges.add(e2Id);
    this.indexEdge(e1);
    this.indexEdge(e2);

    return newId;
  }

  private findEdgeBetween(a: NodeId, b: NodeId): EdgeId | null {
    const an = this.nodes.get(a);
    if (!an) return null;
    for (const eid of an.edges) {
      const e = this.edges.get(eid)!;
      if ((e.from === a && e.to === b) || (e.from === b && e.to === a)) return eid;
    }
    return null;
  }

  private indexNode(n: GraphNode): void {
    const k = cellKey(Math.floor(n.x / CELL), Math.floor(n.y / CELL));
    let set = this.nodeGrid.get(k);
    if (!set) {
      set = new Set();
      this.nodeGrid.set(k, set);
    }
    set.add(n.id);
  }

  private unindexNode(n: GraphNode): void {
    const k = cellKey(Math.floor(n.x / CELL), Math.floor(n.y / CELL));
    const set = this.nodeGrid.get(k);
    if (!set) return;
    set.delete(n.id);
    if (set.size === 0) this.nodeGrid.delete(k);
  }

  private indexEdge(e: GraphEdge): void {
    const a = this.nodes.get(e.from)!;
    const b = this.nodes.get(e.to)!;
    const cells = this.cellsForSegment(a.x, a.y, b.x, b.y);
    this.edgeCells.set(e.id, cells);
    for (const k of cells) {
      let set = this.edgeGrid.get(k);
      if (!set) {
        set = new Set();
        this.edgeGrid.set(k, set);
      }
      set.add(e.id);
    }
  }

  private unindexEdge(e: GraphEdge): void {
    const cells = this.edgeCells.get(e.id);
    if (!cells) return;
    for (const k of cells) {
      const set = this.edgeGrid.get(k);
      if (!set) continue;
      set.delete(e.id);
      if (set.size === 0) this.edgeGrid.delete(k);
    }
    this.edgeCells.delete(e.id);
  }

  // Bbox-based bucketing — over-includes a tiny bit on diagonals, but cheap and correct.
  private cellsForSegment(x0: number, y0: number, x1: number, y1: number): string[] {
    const cx0 = Math.floor(Math.min(x0, x1) / CELL);
    const cx1 = Math.floor(Math.max(x0, x1) / CELL);
    const cy0 = Math.floor(Math.min(y0, y1) / CELL);
    const cy1 = Math.floor(Math.max(y0, y1) / CELL);
    const out: string[] = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) out.push(cellKey(cx, cy));
    }
    return out;
  }
}
