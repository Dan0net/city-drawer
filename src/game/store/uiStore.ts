import { create } from 'zustand';

interface UiState {
  showGrid: boolean;
  showFps: boolean;
  showFrontages: boolean;
  snapDraw: boolean;
  toggleGrid: () => void;
  toggleFps: () => void;
  toggleFrontages: () => void;
  toggleSnapDraw: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  showGrid: true,
  showFps: true,
  showFrontages: false,
  snapDraw: false,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleFps: () => set((s) => ({ showFps: !s.showFps })),
  toggleFrontages: () => set((s) => ({ showFrontages: !s.showFrontages })),
  toggleSnapDraw: () => set((s) => ({ snapDraw: !s.snapDraw })),
}));
