import { create } from 'zustand';
import { Graph } from '@game/graph';
import type { EdgeId, EdgeKind } from '@game/graph';
import type { Building, BuildingId, FailedAttempt } from '@game/buildings';
import { removeBuildingRestoring } from '@game/buildings/bulldoze';
import {
  beginOrCommitDraw as commitDraw,
  type DrawCommitResult,
} from '@game/drawing/commit';
import {
  computePointerState,
  type BulldozeHover,
  type Tool,
} from '@game/drawing/pointer';
import type { SnapResult } from '@game/drawing/snap';
import { createDemandMaps, type DemandMap } from '@game/demand/maps';
import { createSpawnEngine } from '@game/sim/spawn';

export type { Tool };

interface WorldState {
  graph: Graph;
  graphVersion: number;
  buildings: Building[];
  buildingsVersion: number;
  failedAttempts: FailedAttempt[];
  failedAttemptsVersion: number;
  tool: Tool;
  drawingStart: SnapResult | null;
  pointerWorld: { x: number; y: number } | null;
  snap: SnapResult | null;
  bulldozeHover: BulldozeHover | null;
  // Buildings the in-progress road would bulldoze on commit.
  bulldozePreview: BuildingId[];
  // Points where the in-progress road would cross existing edges. Each
  // becomes a real node on commit (splitting both lines).
  drawingCrossings: { x: number; y: number }[];
  // Auto-subdivision points along the in-progress road at ~100m spacing.
  drawingMidpoints: { x: number; y: number }[];
  simTime: number;
  paused: boolean;
  demandMaps: DemandMap[];
  // Bumped when any demand map's data changes (cell write, road-field rebuild).
  demandMapsVersion: number;

  setTool(t: Tool): void;
  toggleTool(t: Exclude<Tool, 'none'>): void;
  setPointer(x: number, y: number, snapRadiusWorld: number, opts: { snapDraw: boolean }): void;
  clearPointer(): void;
  beginOrCommitDraw(kind: EdgeKind): void;
  cancelDraw(): void;
  removeAtPointer(): void;
  clearBuildings(): void;
  clearAll(): void;
  simStep(dt: number): void;
  togglePause(): void;
}

const idleDrawingState = {
  drawingStart: null as SnapResult | null,
  bulldozeHover: null as BulldozeHover | null,
  bulldozePreview: [] as BuildingId[],
  drawingCrossings: [] as { x: number; y: number }[],
  drawingMidpoints: [] as { x: number; y: number }[],
};

export const useWorldStore = create<WorldState>((set, get) => {
  const graph = new Graph();
  const buildings: Building[] = [];
  const failedAttempts: FailedAttempt[] = [];
  const demandMaps = createDemandMaps(1337);
  const spawn = createSpawnEngine();

  return {
    graph,
    graphVersion: 0,
    buildings,
    buildingsVersion: 0,
    failedAttempts,
    failedAttemptsVersion: 0,
    tool: 'none',
    drawingStart: null,
    pointerWorld: null,
    snap: null,
    bulldozeHover: null,
    bulldozePreview: [],
    drawingCrossings: [],
    drawingMidpoints: [],
    simTime: 0,
    paused: false,
    demandMaps,
    demandMapsVersion: 0,

    setTool: (t) => set({ tool: t, ...idleDrawingState }),

    toggleTool: (t) =>
      set((s) => ({ tool: s.tool === t ? 'none' : t, ...idleDrawingState })),

    setPointer: (x, y, radius, opts) => {
      const { graph: g, tool, buildings: bs, drawingStart } = get();
      set(computePointerState(g, bs, tool, drawingStart, x, y, radius, opts));
    },

    clearPointer: () =>
      set({ pointerWorld: null, snap: null, ...idleDrawingState, drawingStart: get().drawingStart }),

    beginOrCommitDraw: (kind) => {
      const { drawingStart, snap, graph: g, buildings: bs } = get();
      if (!snap) return;
      const result: DrawCommitResult = commitDraw(g, bs, drawingStart, snap, kind);
      if (result.kind === 'begin') {
        set({ drawingStart: result.drawingStart });
        return;
      }
      if (result.kind === 'cancel') {
        set({ drawingStart: null, bulldozePreview: [], drawingCrossings: [], drawingMidpoints: [] });
        return;
      }
      const patch: Partial<WorldState> = {
        graphVersion: g.version,
        drawingStart: result.drawingStart,
        bulldozePreview: [],
        drawingCrossings: [],
        drawingMidpoints: [],
      };
      if (result.buildingsChanged) patch.buildingsVersion = get().buildingsVersion + 1;
      set(patch);
    },

    cancelDraw: () => set({ ...idleDrawingState }),

    removeAtPointer: () => {
      const { graph: g, bulldozeHover, buildings: bs } = get();
      if (!bulldozeHover) return;
      if (bulldozeHover.kind === 'building') {
        const bumpGraph = removeBuildingRestoring(g, bs, bulldozeHover.id, null);
        set({
          buildingsVersion: get().buildingsVersion + 1,
          bulldozeHover: null,
          ...(bumpGraph ? { graphVersion: g.version } : {}),
        });
        return;
      }
      // Edge or node removal — collect the affected edges, bulldoze any
      // building whose primary face sits on one of them, then drop the edge/node.
      const affected = new Set<EdgeId>();
      if (bulldozeHover.kind === 'edge') {
        affected.add(bulldozeHover.id);
      } else {
        const node = g.nodes.get(bulldozeHover.id);
        if (node) for (const eid of node.edges) affected.add(eid);
      }
      let bumpBuildings = false;
      for (let i = bs.length - 1; i >= 0; i--) {
        const primaryEdge = bs[i].consumed[0]?.edgeId;
        if (primaryEdge != null && affected.has(primaryEdge)) {
          removeBuildingRestoring(g, bs, bs[i].id, affected);
          bumpBuildings = true;
        }
      }
      if (bulldozeHover.kind === 'edge') g.removeEdge(bulldozeHover.id);
      else g.removeNode(bulldozeHover.id);
      const patch: Partial<WorldState> = {
        graphVersion: g.version,
        bulldozeHover: null,
      };
      if (bumpBuildings) patch.buildingsVersion = get().buildingsVersion + 1;
      set(patch);
    },

    clearBuildings: () => {
      const { graph: g, buildings: bs, failedAttempts: fa } = get();
      if (bs.length === 0 && fa.length === 0) return;
      let bumpGraph = false;
      for (const b of bs) {
        for (const c of b.consumed) {
          if (g.restoreFrontage(c.edgeId, c.side, c.t0, c.t1)) bumpGraph = true;
        }
      }
      bs.length = 0;
      fa.length = 0;
      set({
        buildingsVersion: get().buildingsVersion + 1,
        failedAttemptsVersion: get().failedAttemptsVersion + 1,
        bulldozeHover: null,
        ...(bumpGraph ? { graphVersion: g.version } : {}),
      });
    },

    clearAll: () => {
      const { graph: g, buildings: bs, failedAttempts: fa } = get();
      g.clear();
      bs.length = 0;
      fa.length = 0;
      set({
        graphVersion: g.version,
        buildingsVersion: get().buildingsVersion + 1,
        failedAttemptsVersion: get().failedAttemptsVersion + 1,
        ...idleDrawingState,
      });
    },

    simStep: (dt) => {
      const s = get();
      if (s.paused) return;
      const newSimTime = s.simTime + dt;
      const r = spawn.tick(
        {
          graph: s.graph,
          buildings: s.buildings,
          failedAttempts: s.failedAttempts,
          demandMaps: s.demandMaps,
        },
        newSimTime,
        Math.random,
      );
      const patch: Partial<WorldState> = { simTime: newSimTime };
      if (r.buildingsChanged) patch.buildingsVersion = s.buildingsVersion + 1;
      if (r.failedChanged) patch.failedAttemptsVersion = s.failedAttemptsVersion + 1;
      if (r.graphChanged) patch.graphVersion = s.graph.version;
      set(patch);
    },

    togglePause: () => set((s) => ({ paused: !s.paused })),
  };
});

// Demand-map road fields are derived from graph + buildings. Recompute
// whenever either changes; the next sim tick then picks the highest-demand
// thing to spawn.
{
  let lastGraphVersion = -1;
  let lastBuildingsVersion = -1;
  const recompute = (s: WorldState): void => {
    if (
      s.graphVersion === lastGraphVersion &&
      s.buildingsVersion === lastBuildingsVersion
    ) {
      return;
    }
    lastGraphVersion = s.graphVersion;
    lastBuildingsVersion = s.buildingsVersion;
    for (const m of s.demandMaps) m.recompute({ graph: s.graph, buildings: s.buildings });
    useWorldStore.setState((curr) => ({ demandMapsVersion: curr.demandMapsVersion + 1 }));
  };
  recompute(useWorldStore.getState());
  useWorldStore.subscribe(recompute);
}

