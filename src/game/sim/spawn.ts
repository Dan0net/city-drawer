import type { Building, FailedAttempt } from '@game/buildings';
import { pickFrontageOnEdge, placeBuildingOnFrontage } from '@game/buildings/spawn';
import type { Graph } from '@game/graph';
import type { DemandMap } from '@game/demand/maps';
import { DEMAND_TYPES } from '@game/demand/types';
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

interface SpawnEngine {
  tick(ctx: SpawnCtx, simTime: number, rand: () => number): SpawnTickResult;
}

const sampleInterval = (rand: () => number): number =>
  SPAWN_INTERVAL_MIN + rand() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);

// Owns spawn cadence and id allocators. State outside the store so the
// store stays a passive value bag.
export function createSpawnEngine(): SpawnEngine {
  let nextBuildingId = 1;
  let nextFailedId = 1;
  // Negative so the first tick fires immediately; cadence kicks in afterwards.
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
            } else {
              ctx.failedAttempts.push({ ...placement.failure, id: nextFailedId++ });
              result.failedChanged = true;
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
