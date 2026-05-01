import type { Building, BuildingId, BuildingType, FailedAttempt } from '@game/buildings';
import { pickFrontageOnEdge, placeBuildingOnFrontage } from '@game/buildings/spawn';
import type { Graph } from '@game/graph';
import type { DemandMap } from '@game/demand/maps';
import type { DemandDef } from '@game/demand/types';
import { pickDemand, pickEdgeForDemand } from './picker';
import {
  settleNewBuilding,
  sinkSlotDemand,
  slotsClaimedBy,
  type AttributionLedgers,
  type TrafficState,
} from './attribution';
import { failedAttemptLifetime } from './animation';
import { SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX } from './config';

interface SpawnCtx {
  graph: Graph;
  buildings: Building[];
  failedAttempts: FailedAttempt[];
  demandMaps: DemandMap[];
  ledgers: AttributionLedgers;
  traffic: TrafficState;
}

interface SpawnTickResult {
  buildingsChanged: boolean;
  failedChanged: boolean;
  graphChanged: boolean;
  attributionsChanged: boolean;
}

type SpawnEventPayload =
  | {
      kind: 'success';
      t: number;
      demandId: string;
      sinkType: BuildingType;
      sinkId: BuildingId;
      slotsClaimed: number;
      slotsDemanded: number;
    }
  | {
      kind: 'physical_failure';
      t: number;
      demandId: string;
      sinkType: BuildingType;
      reason: string;
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

// Two-stage picker: stage 1 picks a demand by globalAvail^EXP; stage 2 picks
// an edge by field^EXP. After physical placement the new building goes
// through `settleNewBuilding` which fills its sink demand from the closest
// sources, and pulls in any nearby under-allocated sinks for the demands it
// sources. Sinks may end up partially attributed — that's fine.
//
// `nextBuildingId` is allocated only on commit so discarded placements don't
// leave id gaps (no_frontage / placement failure paths).
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
        attributionsChanged: false,
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
  const def = pickDemand(ctx.buildings, ctx.demandMaps, ctx.ledgers, rand);
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
    return;
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

  const b: Building = { ...placement.building, id: allocBuildingId() };
  ctx.buildings.push(b);
  for (const c of b.consumed) {
    if (ctx.graph.consumeFrontage(c.edgeId, c.side, c.t0, c.t1)) {
      result.graphChanged = true;
    }
  }
  result.buildingsChanged = true;

  settleNewBuilding(b, {
    graph: ctx.graph,
    buildings: ctx.buildings,
    ledgers: ctx.ledgers,
    traffic: ctx.traffic,
  });
  result.attributionsChanged = true;

  reportSuccess(onEvent, simTime, b, def, ctx.ledgers);
}

function reportSuccess(
  onEvent: ((e: SpawnEventPayload) => void) | undefined,
  simTime: number,
  b: Building,
  def: DemandDef,
  ledgers: AttributionLedgers,
): void {
  if (!onEvent) return;
  const ledger = ledgers.get(def.id);
  const slotsDemanded = sinkSlotDemand(b, def);
  const slotsClaimed = ledger ? slotsClaimedBy(ledger, b.id) : 0;
  onEvent({
    kind: 'success',
    t: simTime,
    demandId: def.id,
    sinkType: def.sink.type,
    sinkId: b.id,
    slotsClaimed,
    slotsDemanded,
  });
}
