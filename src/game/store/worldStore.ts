import { create } from 'zustand';
import { Graph } from '@game/graph';
import type { Anchor, EdgeId, EdgeKind, NodeId } from '@game/graph';
import type { Building, BuildingId } from '@game/buildings';
import { obbContainsPoint } from '@game/buildings';
import { trySpawn } from '@game/spawn';

export type Tool = 'none' | 'road' | 'path' | 'bulldoze';

export type SnapResult =
  | { kind: 'node'; nodeId: NodeId; x: number; y: number }
  | { kind: 'edge'; edgeId: EdgeId; t: number; x: number; y: number }
  | { kind: 'free'; x: number; y: number };

export type BulldozeHover =
  | { kind: 'edge'; id: EdgeId }
  | { kind: 'node'; id: NodeId }
  | { kind: 'building'; id: BuildingId };

export interface WorldState {
  graph: Graph;
  graphVersion: number;
  buildings: Building[];
  buildingsVersion: number;
  tool: Tool;
  drawingStart: SnapResult | null;
  pointerWorld: { x: number; y: number } | null;
  snap: SnapResult | null;
  bulldozeHover: BulldozeHover | null;
  simTime: number;
  paused: boolean;

  setTool(t: Tool): void;
  toggleTool(t: Exclude<Tool, 'none'>): void;
  setPointer(x: number, y: number, snapRadiusWorld: number): void;
  clearPointer(): void;
  beginOrCommitDraw(kind: EdgeKind): void;
  cancelDraw(): void;
  removeAtPointer(): void;
  clearBuildings(): void;
  clearAll(): void;
  simStep(dt: number): void;
  togglePause(): void;
}

export const DEVELOP_SECONDS = 30;

const snapToAnchor = (s: SnapResult): Anchor => {
  if (s.kind === 'node') return { kind: 'node', nodeId: s.nodeId };
  if (s.kind === 'edge') return { kind: 'split', edgeId: s.edgeId, t: s.t };
  return { kind: 'free', x: s.x, y: s.y };
};

const computeSnap = (graph: Graph, x: number, y: number, radius: number): SnapResult => {
  const node = graph.nearestNode(x, y, radius);
  if (node) return { kind: 'node', nodeId: node.id, x: node.x, y: node.y };
  const edge = graph.nearestEdge(x, y, radius);
  if (edge) return { kind: 'edge', edgeId: edge.edge.id, t: edge.t, x: edge.px, y: edge.py };
  return { kind: 'free', x, y };
};

const buildingAtPoint = (buildings: Building[], x: number, y: number): Building | null => {
  // Topmost first (last drawn) so click prefers the most recently spawned overlap edge case.
  for (let i = buildings.length - 1; i >= 0; i--) {
    if (obbContainsPoint(buildings[i], x, y)) return buildings[i];
  }
  return null;
};

const SPAWN_INTERVAL_MIN = 2.0; // seconds
const SPAWN_INTERVAL_MAX = 3.0;

export const useWorldStore = create<WorldState>((set, get) => {
  const graph = new Graph();
  const buildings: Building[] = [];
  let nextBuildingId = 1;
  let nextSpawnAt = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);

  return {
    graph,
    graphVersion: 0,
    buildings,
    buildingsVersion: 0,
    tool: 'none',
    drawingStart: null,
    pointerWorld: null,
    snap: null,
    bulldozeHover: null,
    simTime: 0,
    paused: false,

    setTool: (t) => set({ tool: t, drawingStart: null, bulldozeHover: null }),

    toggleTool: (t) =>
      set((s) => ({
        tool: s.tool === t ? 'none' : t,
        drawingStart: null,
        bulldozeHover: null,
      })),

    setPointer: (x, y, radius) => {
      const { graph: g, tool, buildings: bs } = get();
      const pointerWorld = { x, y };
      if (tool === 'road' || tool === 'path') {
        set({ pointerWorld, snap: computeSnap(g, x, y, radius), bulldozeHover: null });
      } else if (tool === 'bulldoze') {
        const b = buildingAtPoint(bs, x, y);
        if (b) {
          set({ pointerWorld, snap: null, bulldozeHover: { kind: 'building', id: b.id } });
          return;
        }
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
      if (
        drawingStart.kind === 'node' &&
        snap.kind === 'node' &&
        drawingStart.nodeId === snap.nodeId
      ) {
        set({ drawingStart: null });
        return;
      }
      const result = g.insertEdge(snapToAnchor(drawingStart), snapToAnchor(snap), kind);
      if (!result) return;

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
      const { graph: g, bulldozeHover, buildings: bs } = get();
      if (!bulldozeHover) return;
      if (bulldozeHover.kind === 'edge') {
        g.removeEdge(bulldozeHover.id);
        set({ graphVersion: g.version, bulldozeHover: null });
      } else if (bulldozeHover.kind === 'node') {
        g.removeNode(bulldozeHover.id);
        set({ graphVersion: g.version, bulldozeHover: null });
      } else {
        const idx = bs.findIndex((b) => b.id === bulldozeHover.id);
        if (idx >= 0) {
          bs.splice(idx, 1);
          set({ buildingsVersion: get().buildingsVersion + 1, bulldozeHover: null });
        }
      }
    },

    clearBuildings: () => {
      const { buildings: bs } = get();
      if (bs.length === 0) return;
      bs.length = 0;
      set({ buildingsVersion: get().buildingsVersion + 1, bulldozeHover: null });
    },

    clearAll: () => {
      const { graph: g, buildings: bs } = get();
      g.clear();
      bs.length = 0;
      set({
        graphVersion: g.version,
        buildingsVersion: get().buildingsVersion + 1,
        drawingStart: null,
        bulldozeHover: null,
      });
    },

    simStep: (dt) => {
      const s = get();
      if (s.paused) return;

      const newSimTime = s.simTime + dt;

      // Advance progress on developing buildings (mutate in place — render polls).
      for (const b of s.buildings) {
        if (b.progress < 1) {
          b.progress = Math.min(1, b.progress + dt / DEVELOP_SECONDS);
        }
      }

      // Spawn attempt
      let bumpBuildings = false;
      if (newSimTime >= nextSpawnAt) {
        const placed = trySpawn(
          { graph: s.graph, buildings: s.buildings },
          newSimTime,
          Math.random,
        );
        if (placed) {
          s.buildings.push({ ...placed, id: nextBuildingId++ });
          bumpBuildings = true;
        }
        nextSpawnAt =
          newSimTime +
          SPAWN_INTERVAL_MIN +
          Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
      }

      // simTime always advances (when not paused). buildingsVersion bumps only on
      // add/remove — progress changes are read directly each frame by the renderer.
      if (bumpBuildings) {
        set({ simTime: newSimTime, buildingsVersion: s.buildingsVersion + 1 });
      } else {
        set({ simTime: newSimTime });
      }
    },

    togglePause: () => set((s) => ({ paused: !s.paused })),
  };
});
