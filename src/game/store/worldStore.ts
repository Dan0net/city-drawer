import { create } from 'zustand';
import { Graph } from '@game/graph';
import type { Anchor, EdgeId, EdgeKind, NodeId } from '@game/graph';

export type Tool = 'none' | 'road' | 'path' | 'bulldoze';

export type SnapResult =
  | { kind: 'node'; nodeId: NodeId; x: number; y: number }
  | { kind: 'edge'; edgeId: EdgeId; t: number; x: number; y: number }
  | { kind: 'free'; x: number; y: number };

export type BulldozeHover = { kind: 'edge'; id: EdgeId } | { kind: 'node'; id: NodeId };

export interface WorldState {
  graph: Graph;
  graphVersion: number;
  tool: Tool;
  // Drawing state
  drawingStart: SnapResult | null;
  pointerWorld: { x: number; y: number } | null;
  snap: SnapResult | null;
  bulldozeHover: BulldozeHover | null;

  setTool(t: Tool): void;
  toggleTool(t: Exclude<Tool, 'none'>): void;
  setPointer(x: number, y: number, snapRadiusWorld: number): void;
  clearPointer(): void;
  beginOrCommitDraw(kind: EdgeKind): void;
  cancelDraw(): void;
  removeAtPointer(): void;
  clearAll(): void;
}

const snapToAnchor = (s: SnapResult): Anchor => {
  if (s.kind === 'node') return { kind: 'node', nodeId: s.nodeId };
  if (s.kind === 'edge') return { kind: 'split', edgeId: s.edgeId, t: s.t };
  return { kind: 'free', x: s.x, y: s.y };
};

const computeSnap = (graph: Graph, x: number, y: number, radius: number): SnapResult => {
  const node = graph.nearestNode(x, y, radius);
  if (node) return { kind: 'node', nodeId: node.id, x: node.x, y: node.y };
  const edge = graph.nearestEdge(x, y, radius);
  if (edge) {
    return { kind: 'edge', edgeId: edge.edge.id, t: edge.t, x: edge.px, y: edge.py };
  }
  return { kind: 'free', x, y };
};

export const useWorldStore = create<WorldState>((set, get) => {
  const graph = new Graph();
  return {
    graph,
    graphVersion: 0,
    tool: 'none',
    drawingStart: null,
    pointerWorld: null,
    snap: null,
    bulldozeHover: null,

    setTool: (t) => set({ tool: t, drawingStart: null, bulldozeHover: null }),

    toggleTool: (t) =>
      set((s) => ({
        tool: s.tool === t ? 'none' : t,
        drawingStart: null,
        bulldozeHover: null,
      })),

    setPointer: (x, y, radius) => {
      const { graph: g, tool } = get();
      const pointerWorld = { x, y };
      if (tool === 'road' || tool === 'path') {
        set({ pointerWorld, snap: computeSnap(g, x, y, radius), bulldozeHover: null });
      } else if (tool === 'bulldoze') {
        const node = g.nearestNode(x, y, radius);
        if (node) {
          set({ pointerWorld, snap: null, bulldozeHover: { kind: 'node', id: node.id } });
          return;
        }
        const edge = g.nearestEdge(x, y, radius);
        set({
          pointerWorld,
          snap: null,
          bulldozeHover: edge ? { kind: 'edge', id: edge.edge.id } : null,
        });
      } else {
        set({ pointerWorld, snap: null, bulldozeHover: null });
      }
    },

    clearPointer: () => set({ pointerWorld: null, snap: null, bulldozeHover: null }),

    beginOrCommitDraw: (kind) => {
      const { drawingStart, snap, graph: g } = get();
      if (!snap) return;
      if (!drawingStart) {
        set({ drawingStart: snap });
        return;
      }

      // Click on the same node we're chaining from = end the chain.
      if (
        drawingStart.kind === 'node' &&
        snap.kind === 'node' &&
        drawingStart.nodeId === snap.nodeId
      ) {
        set({ drawingStart: null });
        return;
      }

      const result = g.insertEdge(snapToAnchor(drawingStart), snapToAnchor(snap), kind);
      if (!result) {
        // Zero-length / no-op; leave drawingStart in place so the user can adjust.
        return;
      }

      // Continue the chain: the just-committed end becomes the next start.
      const endNode = g.nodes.get(result.toId);
      if (!endNode) {
        set({ drawingStart: null, graphVersion: g.version });
        return;
      }
      set({
        drawingStart: { kind: 'node', nodeId: endNode.id, x: endNode.x, y: endNode.y },
        graphVersion: g.version,
      });
    },

    cancelDraw: () => set({ drawingStart: null }),

    removeAtPointer: () => {
      const { graph: g, bulldozeHover } = get();
      if (!bulldozeHover) return;
      if (bulldozeHover.kind === 'edge') {
        g.removeEdge(bulldozeHover.id);
      } else {
        g.removeNode(bulldozeHover.id);
      }
      set({ graphVersion: g.version, bulldozeHover: null });
    },

    clearAll: () => {
      const { graph: g } = get();
      g.clear();
      set({ graphVersion: g.version, drawingStart: null, bulldozeHover: null });
    },
  };
});
