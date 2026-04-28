import { create } from 'zustand';
import { Graph } from '@game/graph';
import type { Anchor, EdgeId, EdgeKind, NodeId } from '@game/graph';
import type { Building, BuildingId, FailedAttempt } from '@game/buildings';
import { JOBS_PER_FACTORY } from '@game/buildings';
import { pickFrontageOnEdge, placeBuildingOnFrontage } from '@game/buildings/spawn';
import { clearCellsUnderPoly } from '@game/demand/cellMap';
import { useUiStore } from '@game/store/uiStore';
import {
  applyDrawSnap,
  computeSnap,
  snapToAnchor,
  type SnapResult,
} from '@game/drawing/snap';
import { subdivideStraight } from '@game/drawing/subdivide';
import { findRoadCrossings } from '@game/roads/crossings';
import {
  buildingAtPoint,
  buildingsWithPrimaryOn,
  predictRoadBulldoze,
  removeBuildingRestoring,
} from '@game/buildings/bulldoze';
import { createDemandMaps, type DemandMap } from '@game/demand/maps';

export type Tool = 'none' | 'road' | 'small_road' | 'path' | 'bulldoze';

type BulldozeHover =
  | { kind: 'edge'; id: EdgeId }
  | { kind: 'node'; id: NodeId }
  | { kind: 'building'; id: BuildingId };

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
  // Buildings the in-progress road would bulldoze on commit. Recomputed on
  // each setPointer while drawingStart is set.
  bulldozePreview: BuildingId[];
  // Points where the in-progress road would cross existing edges. Each
  // becomes a real node on commit (splitting both lines).
  drawingCrossings: { x: number; y: number }[];
  // Auto-subdivision points along the in-progress road at ~100m spacing.
  // Each becomes a free node on commit.
  drawingMidpoints: { x: number; y: number }[];
  simTime: number;
  paused: boolean;
  demandMaps: DemandMap[];
  // Bumped when any demand map's data changes (cell write, road-field rebuild).
  // Renderer subscribes to this rather than to graphVersion directly.
  demandMapsVersion: number;

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

const SPAWN_INTERVAL_MIN = 0.4; // seconds
const SPAWN_INTERVAL_MAX = 0.8;
// Animation timings here mirror the renderer; we only need them so we know when
// a failed-attempt visual is finished and can be pruned.
const EDGE_DURATION_S = 0.2;
const FAILED_HOLD_AFTER_PERIMETER_S = 1.2;

// Hoisted out of the create() closure so the demand subscription below can
// allocate ids when it auto-spawns factories. Only one store instance exists.
let nextBuildingId = 1;

export const useWorldStore = create<WorldState>((set, get) => {
  const graph = new Graph();
  const buildings: Building[] = [];
  const failedAttempts: FailedAttempt[] = [];
  let nextFailedId = 1;
  let nextSpawnAt = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
  const demandMaps = createDemandMaps(1337);

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

    setTool: (t) =>
      set({
        tool: t,
        drawingStart: null,
        bulldozeHover: null,
        bulldozePreview: [],
        drawingCrossings: [],
        drawingMidpoints: [],
      }),

    toggleTool: (t) =>
      set((s) => ({
        tool: s.tool === t ? 'none' : t,
        drawingStart: null,
        bulldozeHover: null,
        bulldozePreview: [],
        drawingCrossings: [],
        drawingMidpoints: [],
      })),

    setPointer: (x, y, radius) => {
      const { graph: g, tool, buildings: bs, drawingStart } = get();
      const pointerWorld = { x, y };
      if (tool === 'road' || tool === 'small_road' || tool === 'path') {
        let newSnap = computeSnap(g, x, y, radius);
        // Snap to existing node/edge always wins over angle+length snap so
        // users can still aim at intersections and split points exactly.
        if (
          drawingStart &&
          newSnap.kind === 'free' &&
          useUiStore.getState().snapDraw
        ) {
          newSnap = applyDrawSnap(g, drawingStart, newSnap);
        }
        const preview = drawingStart
          ? predictRoadBulldoze(drawingStart, newSnap, tool, bs)
          : [];
        const crossings = drawingStart ? findRoadCrossings(g, drawingStart, newSnap) : [];
        // Midpoints subdivide each sub-segment between consecutive fixed points
        // (start → crossing → crossing → end), so they can never land closer
        // than ~50m to a crossing.
        const midpoints: { x: number; y: number }[] = [];
        if (drawingStart) {
          let px = drawingStart.x;
          let py = drawingStart.y;
          for (const c of crossings) {
            for (const m of subdivideStraight(px, py, c.x, c.y)) {
              midpoints.push({ x: m.x, y: m.y });
            }
            px = c.x;
            py = c.y;
          }
          for (const m of subdivideStraight(px, py, newSnap.x, newSnap.y)) {
            midpoints.push({ x: m.x, y: m.y });
          }
        }
        set({
          pointerWorld,
          snap: newSnap,
          bulldozeHover: null,
          bulldozePreview: preview,
          drawingCrossings: crossings.map((c) => ({ x: c.x, y: c.y })),
          drawingMidpoints: midpoints,
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
            drawingCrossings: [],
            drawingMidpoints: [],
          });
          return;
        }
        const edge = g.nearestEdge(x, y, radius);
        set({
          pointerWorld,
          snap: null,
          bulldozeHover: edge ? { kind: 'edge', id: edge.edge.id } : null,
          bulldozePreview: edge ? buildingsWithPrimaryOn(new Set([edge.edge.id]), bs) : [],
          drawingCrossings: [],
          drawingMidpoints: [],
        });
      } else {
        set({
          pointerWorld,
          snap: null,
          bulldozeHover: null,
          bulldozePreview: [],
          drawingCrossings: [],
          drawingMidpoints: [],
        });
      }
    },

    clearPointer: () =>
      set({
        pointerWorld: null,
        snap: null,
        bulldozeHover: null,
        bulldozePreview: [],
        drawingCrossings: [],
        drawingMidpoints: [],
      }),

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
        set({
          drawingStart: null,
          bulldozePreview: [],
          drawingCrossings: [],
          drawingMidpoints: [],
        });
        return;
      }
      // Capture predicted bulldoze targets BEFORE insertEdge — split anchors
      // mutate the graph and would shift edge ids, but the buildings list
      // is keyed by stable building id.
      const toBulldoze = predictRoadBulldoze(drawingStart, snap, kind, bs);

      // Where the new line crosses existing edges. Each becomes a split
      // anchor so both the existing edge and the new line are split at the
      // intersection. Computed BEFORE any insertEdge so edge ids are stable.
      const crossings = findRoadCrossings(g, drawingStart, snap);
      // Build the ordered anchor sequence: walk segments separated by
      // crossings, and inside each segment drop ~100m midpoints. Crossings
      // act as fixed dividers, so midpoints can never crowd a crossing.
      const waypoints: Anchor[] = [];
      {
        let px = drawingStart.x;
        let py = drawingStart.y;
        for (const c of crossings) {
          for (const m of subdivideStraight(px, py, c.x, c.y)) {
            waypoints.push({ kind: 'free', x: m.x, y: m.y });
          }
          waypoints.push({ kind: 'split', edgeId: c.edgeId, t: c.s });
          px = c.x;
          py = c.y;
        }
        for (const m of subdivideStraight(px, py, snap.x, snap.y)) {
          waypoints.push({ kind: 'free', x: m.x, y: m.y });
        }
      }

      let currentAnchor: Anchor = snapToAnchor(drawingStart);
      let lastResult: ReturnType<typeof g.insertEdge> = null;
      for (const w of waypoints) {
        const r = g.insertEdge(currentAnchor, w, kind);
        if (!r) continue;
        currentAnchor = { kind: 'node', nodeId: r.toId };
        lastResult = r;
      }
      const finalResult = g.insertEdge(currentAnchor, snapToAnchor(snap), kind);
      if (finalResult) lastResult = finalResult;

      if (!lastResult) {
        set({ bulldozePreview: [], drawingCrossings: [], drawingMidpoints: [] });
        return;
      }

      let bumpBuildings = false;
      for (const bid of toBulldoze) {
        if (removeBuildingRestoring(g, bs, bid, null)) {
          // restore happened — version already bumped inside graph
        }
        bumpBuildings = true;
      }

      const endNode = g.nodes.get(lastResult.toId);
      const patch: Partial<WorldState> = {
        graphVersion: g.version,
        bulldozePreview: [],
        drawingCrossings: [],
        drawingMidpoints: [],
      };
      if (bumpBuildings) patch.buildingsVersion = get().buildingsVersion + 1;
      patch.drawingStart = endNode
        ? { kind: 'node', nodeId: endNode.id, x: endNode.x, y: endNode.y }
        : null;
      set(patch);
    },

    cancelDraw: () =>
      set({
        drawingStart: null,
        bulldozePreview: [],
        drawingCrossings: [],
        drawingMidpoints: [],
      }),

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
        // Same path as road-bulldoze removals: restores frontage + decrements
        // attributed factory's jobsFilled if this was a house.
        const bumpGraph = removeBuildingRestoring(g, bs, bulldozeHover.id, null);
        set({
          buildingsVersion: get().buildingsVersion + 1,
          bulldozeHover: null,
          ...(bumpGraph ? { graphVersion: g.version } : {}),
        });
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
        const pick = pickHighestDemand(s, Math.random);
        if (pick) {
          const front = pickFrontageOnEdge(s.graph, pick.edgeId, Math.random);
          if (front) {
            const result = placeBuildingOnFrontage(
              { graph: s.graph, buildings: s.buildings },
              front,
              pick.kind,
              newSimTime,
              Math.random,
            );
            if (result.kind === 'success') {
              const newBuilding: Building = { ...result.building, id: nextBuildingId++ };
              if (pick.kind === 'factory') {
                newBuilding.jobsTotal = JOBS_PER_FACTORY;
                newBuilding.jobsFilled = 0;
                const resourceMap = s.demandMaps.find((m) => m.id === 'resource');
                if (resourceMap) {
                  clearCellsUnderPoly(
                    resourceMap.cellMap,
                    newBuilding.poly,
                    newBuilding.aabb,
                  );
                }
              } else if (pick.kind === 'small_house') {
                const f = nearestFactoryWithCapacity(
                  s.graph,
                  s.buildings,
                  newBuilding.centroid,
                );
                if (f) {
                  newBuilding.attributedFactoryId = f.id;
                  f.jobsFilled = (f.jobsFilled ?? 0) + 1;
                }
              }
              s.buildings.push(newBuilding);
              for (const c of newBuilding.consumed) {
                if (s.graph.consumeFrontage(c.edgeId, c.side, c.t0, c.t1)) {
                  bumpGraph = true;
                }
              }
              bumpBuildings = true;
            } else if (result.kind === 'failure') {
              s.failedAttempts.push({ ...result.failure, id: nextFailedId++ });
              bumpFailed = true;
            }
          }
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

// Demand-map road fields are derived from graph + buildings + cell data.
// Recompute whenever either the graph or the building list changes; the
// next sim tick then picks the highest-demand thing to spawn.
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

// ---------- demand-driven spawn picker ----------

// Houses fill jobs while any edge has positive jobs road-field. Once the
// world's jobs are fully filled (every factory at capacity), the picker
// falls through to factories on hot resource edges. Resource is gated by
// a small threshold so very faint road-field tails don't trigger spawns.
//
// Within each tier the pick is weighted-random by score, not argmax — so
// hot edges are preferred but lukewarm ones still get occasional houses,
// and a failed placement on the hottest edge doesn't lock the loop.
const RESOURCE_FACTORY_THRESHOLD = 0.2;
type DemandPick = { kind: 'small_house' | 'factory'; edgeId: EdgeId; score: number };

function pickHighestDemand(s: WorldState, rand: () => number): DemandPick | null {
  const jobsMap = s.demandMaps.find((m) => m.id === 'jobs');
  if (jobsMap) {
    const housePick = weightedDemandPick(s, jobsMap.roadField, 'small_house', 0, rand);
    if (housePick) return housePick;
  }
  const resourceMap = s.demandMaps.find((m) => m.id === 'resource');
  if (resourceMap) {
    const factoryPick = weightedDemandPick(
      s,
      resourceMap.roadField,
      'factory',
      RESOURCE_FACTORY_THRESHOLD,
      rand,
    );
    if (factoryPick) return factoryPick;
  }
  return null;
}

function weightedDemandPick(
  s: WorldState,
  field: ReadonlyMap<NodeId, number>,
  kind: DemandPick['kind'],
  threshold: number,
  rand: () => number,
): DemandPick | null {
  const candidates: DemandPick[] = [];
  let total = 0;
  for (const e of s.graph.edges.values()) {
    const va = field.get(e.from) ?? 0;
    const vb = field.get(e.to) ?? 0;
    const v = (va + vb) * 0.5;
    if (v > threshold) {
      candidates.push({ kind, edgeId: e.id, score: v });
      total += v;
    }
  }
  if (total <= 0) return null;
  let r = rand() * total;
  for (const c of candidates) {
    r -= c.score;
    if (r <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

// Closest factory (graph-distance) with a free job slot, starting from the
// node nearest the house's centroid. Returns null if no factory has slack
// in the connected component.
const FACTORY_NEAREST_RADIUS = 96;

function nearestFactoryWithCapacity(
  graph: Graph,
  buildings: Building[],
  center: { x: number; y: number },
): Building | null {
  const start = graph.nearestNode(center.x, center.y, FACTORY_NEAREST_RADIUS);
  if (!start) return null;
  const factoryByNode = new Map<NodeId, Building>();
  for (const b of buildings) {
    if (b.type !== 'factory') continue;
    if ((b.jobsFilled ?? 0) >= (b.jobsTotal ?? 0)) continue;
    const fn = graph.nearestNode(b.centroid.x, b.centroid.y, FACTORY_NEAREST_RADIUS);
    if (fn) factoryByNode.set(fn.id, b);
  }
  if (factoryByNode.size === 0) return null;
  const visited = new Set<NodeId>([start.id]);
  const queue: NodeId[] = [start.id];
  while (queue.length > 0) {
    const n = queue.shift()!;
    const f = factoryByNode.get(n);
    if (f) return f;
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
  return null;
}
