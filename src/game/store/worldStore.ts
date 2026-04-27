import { create } from 'zustand';
import { Graph } from '@game/graph';
import type { Anchor, EdgeId, EdgeKind, NodeId } from '@game/graph';
import type { Building, BuildingId, FailedAttempt } from '@game/buildings';
import { aabbContainsPoint, pointInPoly, polyOverlapsObb } from '@game/buildings';
import { sideOffset } from '@game/roadGeometry';
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
  failedAttempts: FailedAttempt[];
  failedAttemptsVersion: number;
  tool: Tool;
  drawingStart: SnapResult | null;
  pointerWorld: { x: number; y: number } | null;
  snap: SnapResult | null;
  bulldozeHover: BulldozeHover | null;
  // Buildings the in-progress road would bulldoze on commit. Recomputed on
  // each setPointer while drawingStart is set.
  bulldozePreview: BuildingId[];
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
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (!aabbContainsPoint(b.aabb, x, y)) continue;
    if (pointInPoly(b.poly, x, y)) return b;
  }
  return null;
};

const predictRoadBulldoze = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  kind: EdgeKind,
  buildings: Building[],
): BuildingId[] => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;
  const rot = Math.atan2(dy, dx);
  const width = 2 * sideOffset(kind);
  const out: BuildingId[] = [];
  for (const b of buildings) {
    if (polyOverlapsObb(b.poly, cx, cy, len, width, rot)) out.push(b.id);
  }
  return out;
};

const buildingsWithPrimaryOn = (
  edgeIds: Set<EdgeId>,
  buildings: Building[],
): BuildingId[] => {
  const out: BuildingId[] = [];
  for (const b of buildings) {
    const primaryEdge = b.consumed[0]?.edgeId;
    if (primaryEdge != null && edgeIds.has(primaryEdge)) out.push(b.id);
  }
  return out;
};

// Removes a single building, restoring its consumed frontages on every edge
// other than `excludeEdgeIds` (which we're about to delete). Returns true if
// any frontage was actually restored.
const removeBuildingRestoring = (
  graph: Graph,
  buildings: Building[],
  buildingId: BuildingId,
  excludeEdgeIds: Set<EdgeId> | null,
): boolean => {
  const idx = buildings.findIndex((b) => b.id === buildingId);
  if (idx < 0) return false;
  const b = buildings[idx];
  buildings.splice(idx, 1);
  let restored = false;
  for (const c of b.consumed) {
    if (excludeEdgeIds && excludeEdgeIds.has(c.edgeId)) continue;
    if (graph.restoreFrontage(c.edgeId, c.side, c.t0, c.t1)) restored = true;
  }
  return restored;
};

const SPAWN_INTERVAL_MIN = 0.4; // seconds
const SPAWN_INTERVAL_MAX = 0.8;
// Animation timings here mirror the renderer; we only need them so we know when
// a failed-attempt visual is finished and can be pruned.
const EDGE_DURATION_S = 0.2;
const FAILED_HOLD_AFTER_PERIMETER_S = 1.2;

export const useWorldStore = create<WorldState>((set, get) => {
  const graph = new Graph();
  const buildings: Building[] = [];
  const failedAttempts: FailedAttempt[] = [];
  let nextBuildingId = 1;
  let nextFailedId = 1;
  let nextSpawnAt = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);

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
    simTime: 0,
    paused: false,

    setTool: (t) =>
      set({ tool: t, drawingStart: null, bulldozeHover: null, bulldozePreview: [] }),

    toggleTool: (t) =>
      set((s) => ({
        tool: s.tool === t ? 'none' : t,
        drawingStart: null,
        bulldozeHover: null,
        bulldozePreview: [],
      })),

    setPointer: (x, y, radius) => {
      const { graph: g, tool, buildings: bs, drawingStart } = get();
      const pointerWorld = { x, y };
      if (tool === 'road' || tool === 'path') {
        const newSnap = computeSnap(g, x, y, radius);
        const preview = drawingStart
          ? predictRoadBulldoze(drawingStart, newSnap, tool, bs)
          : [];
        set({
          pointerWorld,
          snap: newSnap,
          bulldozeHover: null,
          bulldozePreview: preview,
        });
      } else if (tool === 'bulldoze') {
        const b = buildingAtPoint(bs, x, y);
        if (b) {
          set({
            pointerWorld,
            snap: null,
            bulldozeHover: { kind: 'building', id: b.id },
            bulldozePreview: [],
          });
          return;
        }
        const node = g.nearestNode(x, y, radius);
        if (node) {
          set({
            pointerWorld,
            snap: null,
            bulldozeHover: { kind: 'node', id: node.id },
            bulldozePreview: buildingsWithPrimaryOn(node.edges, bs),
          });
          return;
        }
        const edge = g.nearestEdge(x, y, radius);
        set({
          pointerWorld,
          snap: null,
          bulldozeHover: edge ? { kind: 'edge', id: edge.edge.id } : null,
          bulldozePreview: edge ? buildingsWithPrimaryOn(new Set([edge.edge.id]), bs) : [],
        });
      } else {
        set({ pointerWorld, snap: null, bulldozeHover: null, bulldozePreview: [] });
      }
    },

    clearPointer: () =>
      set({ pointerWorld: null, snap: null, bulldozeHover: null, bulldozePreview: [] }),

    beginOrCommitDraw: (kind) => {
      const { drawingStart, snap, graph: g, buildings: bs } = get();
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
        set({ drawingStart: null, bulldozePreview: [] });
        return;
      }
      // Capture predicted bulldoze targets BEFORE insertEdge — split anchors
      // mutate the graph and would shift edge ids, but the buildings list
      // is keyed by stable building id.
      const toBulldoze = predictRoadBulldoze(drawingStart, snap, kind, bs);

      const result = g.insertEdge(snapToAnchor(drawingStart), snapToAnchor(snap), kind);
      if (!result) {
        set({ bulldozePreview: [] });
        return;
      }

      let bumpBuildings = false;
      for (const bid of toBulldoze) {
        if (removeBuildingRestoring(g, bs, bid, null)) {
          // restore happened — version already bumped inside graph
        }
        bumpBuildings = true;
      }

      const endNode = g.nodes.get(result.toId);
      const patch: Partial<WorldState> = {
        graphVersion: g.version,
        bulldozePreview: [],
      };
      if (bumpBuildings) patch.buildingsVersion = get().buildingsVersion + 1;
      patch.drawingStart = endNode
        ? { kind: 'node', nodeId: endNode.id, x: endNode.x, y: endNode.y }
        : null;
      set(patch);
    },

    cancelDraw: () => set({ drawingStart: null, bulldozePreview: [] }),

    removeAtPointer: () => {
      const { graph: g, bulldozeHover, buildings: bs } = get();
      if (!bulldozeHover) return;
      if (bulldozeHover.kind === 'edge') {
        const eid = bulldozeHover.id;
        const exclude = new Set<EdgeId>([eid]);
        let bumpBuildings = false;
        // Buildings whose PRIMARY (front) face is on this edge get bulldozed.
        // Back/side contacts on this edge alone are tolerated and leave the
        // building intact; their consumed entries against this edge become
        // stale references that restoreFrontage no-ops on.
        for (let i = bs.length - 1; i >= 0; i--) {
          if (bs[i].consumed[0]?.edgeId === eid) {
            removeBuildingRestoring(g, bs, bs[i].id, exclude);
            bumpBuildings = true;
          }
        }
        g.removeEdge(eid);
        const patch: Partial<WorldState> = {
          graphVersion: g.version,
          bulldozeHover: null,
        };
        if (bumpBuildings) patch.buildingsVersion = get().buildingsVersion + 1;
        set(patch);
      } else if (bulldozeHover.kind === 'node') {
        const nid = bulldozeHover.id;
        const node = g.nodes.get(nid);
        const incidentEdgeIds = new Set<EdgeId>(node ? node.edges : []);
        let bumpBuildings = false;
        for (let i = bs.length - 1; i >= 0; i--) {
          const primaryEdge = bs[i].consumed[0]?.edgeId;
          if (primaryEdge != null && incidentEdgeIds.has(primaryEdge)) {
            removeBuildingRestoring(g, bs, bs[i].id, incidentEdgeIds);
            bumpBuildings = true;
          }
        }
        g.removeNode(nid);
        const patch: Partial<WorldState> = {
          graphVersion: g.version,
          bulldozeHover: null,
        };
        if (bumpBuildings) patch.buildingsVersion = get().buildingsVersion + 1;
        set(patch);
      } else {
        const idx = bs.findIndex((b) => b.id === bulldozeHover.id);
        if (idx >= 0) {
          const removed = bs[idx];
          bs.splice(idx, 1);
          let bumpGraph = false;
          for (const c of removed.consumed) {
            if (g.restoreFrontage(c.edgeId, c.side, c.t0, c.t1)) bumpGraph = true;
          }
          set({
            buildingsVersion: get().buildingsVersion + 1,
            bulldozeHover: null,
            ...(bumpGraph ? { graphVersion: g.version } : {}),
          });
        }
      }
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
        drawingStart: null,
        bulldozeHover: null,
      });
    },

    simStep: (dt) => {
      const s = get();
      if (s.paused) return;
      const newSimTime = s.simTime + dt;

      let bumpBuildings = false;
      let bumpFailed = false;
      let bumpGraph = false;

      if (newSimTime >= nextSpawnAt) {
        const result = trySpawn(
          { graph: s.graph, buildings: s.buildings },
          newSimTime,
          Math.random,
        );
        if (result?.kind === 'success') {
          s.buildings.push({ ...result.building, id: nextBuildingId++ });
          for (const c of result.building.consumed) {
            if (s.graph.consumeFrontage(c.edgeId, c.side, c.t0, c.t1)) {
              bumpGraph = true;
            }
          }
          bumpBuildings = true;
        } else if (result?.kind === 'failure') {
          s.failedAttempts.push({ ...result.failure, id: nextFailedId++ });
          bumpFailed = true;
        }
        nextSpawnAt =
          newSimTime +
          SPAWN_INTERVAL_MIN +
          Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
      }

      // Prune failed attempts whose visualization has run its course.
      // Lifetime = perimeter animation (numEdges * EDGE_DURATION) + a hold beat.
      const fa = s.failedAttempts;
      while (fa.length > 0) {
        const att = fa[0];
        const lifetime =
          (att.poly.length / 2) * EDGE_DURATION_S + FAILED_HOLD_AFTER_PERIMETER_S;
        if (newSimTime - att.spawnedAt < lifetime) break;
        fa.shift();
        bumpFailed = true;
      }

      const patch: Partial<WorldState> = { simTime: newSimTime };
      if (bumpBuildings) patch.buildingsVersion = s.buildingsVersion + 1;
      if (bumpFailed) patch.failedAttemptsVersion = s.failedAttemptsVersion + 1;
      if (bumpGraph) patch.graphVersion = s.graph.version;
      set(patch);
    },

    togglePause: () => set((s) => ({ paused: !s.paused })),
  };
});
