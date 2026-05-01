import { create } from 'zustand';
import type { BuildingId, BuildingType } from '@game/buildings';

const BUFFER_LIMIT = 200;

export type SpawnEvent = { id: number } & (
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
  | { kind: 'no_spawnable_demand'; t: number }
);

interface DebugState {
  events: SpawnEvent[];
  // Bumped on each push so subscribers can re-render without deep-equal checks.
  version: number;
  push(e: Omit<SpawnEvent, 'id'>): void;
  clear(): void;
}

let nextId = 1;

export const useDebugStore = create<DebugState>((set) => ({
  events: [],
  version: 0,
  push: (e) =>
    set((s) => {
      const event = { ...e, id: nextId++ } as SpawnEvent;
      const next = [event, ...s.events];
      if (next.length > BUFFER_LIMIT) next.length = BUFFER_LIMIT;
      return { events: next, version: s.version + 1 };
    }),
  clear: () => set({ events: [], version: 0 }),
}));
