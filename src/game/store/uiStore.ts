import { create } from 'zustand';

interface UiState {
  showGrid: boolean;
  showFps: boolean;
  showFrontages: boolean;
  snapDraw: boolean;
  // null = no demand overlay; otherwise the id of the active map.
  activeDemandMap: string | null;
  toggleGrid: () => void;
  toggleFps: () => void;
  toggleFrontages: () => void;
  toggleSnapDraw: () => void;
  cycleDemandMap: (ids: string[]) => void;
  setDemandMap: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  showGrid: true,
  showFps: true,
  showFrontages: false,
  snapDraw: false,
  activeDemandMap: 'resource',
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleFps: () => set((s) => ({ showFps: !s.showFps })),
  toggleFrontages: () => set((s) => ({ showFrontages: !s.showFrontages })),
  toggleSnapDraw: () => set((s) => ({ snapDraw: !s.snapDraw })),
  cycleDemandMap: (ids) =>
    set((s) => {
      // Cycles through [null, ...ids, null, ...]
      const order: (string | null)[] = [null, ...ids];
      const i = order.indexOf(s.activeDemandMap);
      const next = order[(i + 1) % order.length];
      return { activeDemandMap: next };
    }),
  setDemandMap: (id) => set({ activeDemandMap: id }),
}));
