import type { Building, BuildingId, BuildingType, FailedAttempt } from '@game/buildings';
import { pickFrontageOnEdge, placeBuildingOnFrontage } from '@game/buildings/spawn';
import type { Graph } from '@game/graph';
import type { DemandMap } from '@game/demand/maps';
import type { DemandDef } from '@game/demand/types';
import { pickDemand, pickEdgeForDemand } from './picker';
import { commitAttribution, findSources } from './attribution';
import { failedAttemptLifetime } from './animation';
import { SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX } from './config';

interface SpawnCtx {
  graph: Graph;
  buildings: Building[];
  failedAttempts: FailedAttempt[];
  demandMaps: DemandMap[];
}

interface SpawnTickResult {
  buildingsChanged: boolean;
  failedChanged: boolean;
  graphChanged: boolean;
}

interface AttributionRecord {
  sourceId: BuildingId;
  filledAfter: number;
}

type SpawnEventPayload =
  | {
      kind: 'success';
      t: number;
      demandId: string;
      sinkType: BuildingType;
      sourceType: BuildingType | 'cells';
      sourceCapacity: number;
      attributions: AttributionRecord[];
      targetCount: number;
    }
  | {
      kind: 'physical_failure';
      t: number;
      demandId: string;
      sinkType: BuildingType;
      reason: string;
    }
  | {
      kind: 'no_route_for_demand';
      t: number;
      demandId: string;
      sinkType: BuildingType;
    }
  | { kind: 'no_spawnable_demand'; t: number };

interface SpawnEngineOptions {
  onEvent?: (e: SpawnEventPayload) => void;
}

interface SpawnEngine {
  tick(ctx: SpawnCtx, simTime: number, rand: () => number): SpawnTickResult;
}

const sampleInterval = (rand: () => number): number =>
  SPAWN_INTERVAL_MIN + rand() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);

const sourceLabel = (def: DemandDef): BuildingType | 'cells' =>
  def.source.kind === 'cells' ? 'cells' : def.source.type;

// Two-stage picker with retry: stage 1 picks a demand by globalAvail^EXP;
// stage 2 picks an edge by field^EXP. If physical placement fails, that's
// final (no retry — report and stop). If attribution finds no graph route to
// any source for a building-sourced demand, exclude that demand and retry
// across the remaining demands. When all demands are excluded (or none have
// avail > 0), the tick gives up.
//
// `nextBuildingId` is allocated only on commit so discarded placements
// don't leave id gaps.
export function createSpawnEngine(opts: SpawnEngineOptions = {}): SpawnEngine {
  const { onEvent } = opts;
  let nextBuildingId = 1;
  let nextFailedId = 1;
  let nextSpawnAt = 0;

  return {
    tick(ctx, simTime, rand) {
      const result: SpawnTickResult = {
        buildingsChanged: false,
        failedChanged: false,
        graphChanged: false,
      };

      if (simTime >= nextSpawnAt) {
        runSpawnAttempt(ctx, simTime, rand, result, onEvent, () => nextBuildingId++, () => nextFailedId++);
        nextSpawnAt = simTime + sampleInterval(rand);
      }

      // Prune failed attempts whose visualization has finished.
      const fa = ctx.failedAttempts;
      while (fa.length > 0) {
        if (simTime - fa[0].spawnedAt < failedAttemptLifetime(fa[0].poly.length / 2)) break;
        fa.shift();
        result.failedChanged = true;
      }

      return result;
    },
  };
}

function runSpawnAttempt(
  ctx: SpawnCtx,
  simTime: number,
  rand: () => number,
  result: SpawnTickResult,
  onEvent: ((e: SpawnEventPayload) => void) | undefined,
  allocBuildingId: () => BuildingId,
  allocFailedId: () => number,
): void {
  const excluded = new Set<string>();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const def = pickDemand(ctx.buildings, ctx.demandMaps, excluded, rand);
    if (!def) {
      onEvent?.({ kind: 'no_spawnable_demand', t: simTime });
      return;
    }

    const edgeId = pickEdgeForDemand(ctx.graph, def, ctx.demandMaps, rand);
    if (edgeId == null) {
      onEvent?.({ kind: 'no_spawnable_demand', t: simTime });
      return;
    }

    const front = pickFrontageOnEdge(ctx.graph, edgeId, rand);
    if (!front) {
      onEvent?.({
        kind: 'physical_failure',
        t: simTime,
        demandId: def.id,
        sinkType: def.sink.type,
        reason: 'no_frontage',
      });
      return; // physical failure — no retry
    }

    const placement = placeBuildingOnFrontage(
      { graph: ctx.graph, buildings: ctx.buildings },
      front,
      def.sink.type,
      simTime,
      rand,
    );
    if (placement.kind === 'failure') {
      ctx.failedAttempts.push({ ...placement.failure, id: allocFailedId() });
      result.failedChanged = true;
      onEvent?.({
        kind: 'physical_failure',
        t: simTime,
        demandId: def.id,
        sinkType: def.sink.type,
        reason: placement.failure.reason,
      });
      return;
    }

    // Building-sourced: validate there's a graph route to a source with slack.
    // Cell-sourced: no validation needed (cells are always "reachable" via
    // sample radius; consumption is just a count).
    let sources: Building[] = [];
    if (def.source.kind === 'building') {
      sources = findSources(placement.building, def, ctx.graph, ctx.buildings);
      if (sources.length === 0) {
        onEvent?.({
          kind: 'no_route_for_demand',
          t: simTime,
          demandId: def.id,
          sinkType: def.sink.type,
        });
        excluded.add(def.id);
        continue; // discard placement, retry with another demand
      }
    }

    // Commit.
    const b: Building = { ...placement.building, id: allocBuildingId() };
    commitAttribution(b, def, sources);
    ctx.buildings.push(b);
    for (const c of b.consumed) {
      if (ctx.graph.consumeFrontage(c.edgeId, c.side, c.t0, c.t1)) {
        result.graphChanged = true;
      }
    }
    result.buildingsChanged = true;

    const attributions: AttributionRecord[] = sources.map((s) => ({
      sourceId: s.id,
      filledAfter: s.filled?.[def.id] ?? 0,
    }));
    onEvent?.({
      kind: 'success',
      t: simTime,
      demandId: def.id,
      sinkType: def.sink.type,
      sourceType: sourceLabel(def),
      sourceCapacity: def.source.kind === 'building' ? def.source.capacity : 0,
      attributions,
      targetCount: def.sink.count,
    });
    return;
  }
}
