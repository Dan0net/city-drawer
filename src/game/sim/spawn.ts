import type { Building, BuildingId, BuildingType, FailedAttempt } from '@game/buildings';
import { pickFrontageOnEdge, placeBuildingOnFrontage } from '@game/buildings/spawn';
import type { Graph } from '@game/graph';
import type { DemandMap } from '@game/demand/maps';
import { DEMAND_TYPES, type DemandDef } from '@game/demand/types';
import { pickSpawn } from './picker';
import { applyAttribution } from './attribution';
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

// Per-source post-fill state. Empty for cell-sourced demands (factory →
// resource cells); single-element for 1:1 sinks; multi-element for 1:N.
interface AttributionRecord {
  sourceId: BuildingId;
  filledAfter: number;
}

type SpawnEventPayload =
  | {
      ok: true;
      t: number;
      demandId: string;
      sinkType: BuildingType;
      sourceType: BuildingType | 'cells';
      sourceCapacity: number;
      attributions: AttributionRecord[];
      targetCount: number;
    }
  | {
      ok: false;
      t: number;
      demandId: string;
      sinkType: BuildingType;
      reason: string;
    };

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

// Owns spawn cadence and id allocators. State outside the store so the
// store stays a passive value bag. `onEvent` (optional) receives a
// success/failure payload for every spawn attempt that reached placement.
export function createSpawnEngine(opts: SpawnEngineOptions = {}): SpawnEngine {
  const { onEvent } = opts;
  let nextBuildingId = 1;
  let nextFailedId = 1;
  // Zero so the first tick fires immediately; cadence kicks in afterwards.
  let nextSpawnAt = 0;

  return {
    tick(ctx, simTime, rand) {
      const result: SpawnTickResult = {
        buildingsChanged: false,
        failedChanged: false,
        graphChanged: false,
      };

      if (simTime >= nextSpawnAt) {
        const pick = pickSpawn(ctx.graph, DEMAND_TYPES, ctx.demandMaps, rand);
        if (pick) {
          const front = pickFrontageOnEdge(ctx.graph, pick.edgeId, rand);
          if (front) {
            const placement = placeBuildingOnFrontage(
              { graph: ctx.graph, buildings: ctx.buildings },
              front,
              pick.def.sink.type,
              simTime,
              rand,
            );
            if (placement.kind === 'success') {
              const b: Building = { ...placement.building, id: nextBuildingId++ };
              const map = ctx.demandMaps.find((m) => m.id === pick.def.id);
              if (map) applyAttribution(b, pick.def, map, ctx.graph, ctx.buildings);
              ctx.buildings.push(b);
              for (const c of b.consumed) {
                if (ctx.graph.consumeFrontage(c.edgeId, c.side, c.t0, c.t1)) {
                  result.graphChanged = true;
                }
              }
              result.buildingsChanged = true;
              const attributions: AttributionRecord[] = [];
              if (b.attributedToIds && pick.def.source.kind === 'building') {
                for (const sid of b.attributedToIds) {
                  const src = ctx.buildings.find((x) => x.id === sid);
                  if (!src) continue;
                  attributions.push({
                    sourceId: sid,
                    filledAfter: src.filled?.[pick.def.id] ?? 0,
                  });
                }
              }
              onEvent?.({
                ok: true,
                t: simTime,
                demandId: pick.def.id,
                sinkType: pick.def.sink.type,
                sourceType: sourceLabel(pick.def),
                sourceCapacity:
                  pick.def.source.kind === 'building' ? pick.def.source.capacity : 0,
                attributions,
                targetCount: pick.def.sink.count,
              });
            } else {
              ctx.failedAttempts.push({ ...placement.failure, id: nextFailedId++ });
              result.failedChanged = true;
              onEvent?.({
                ok: false,
                t: simTime,
                demandId: pick.def.id,
                sinkType: pick.def.sink.type,
                reason: placement.failure.reason,
              });
            }
          }
        }
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
