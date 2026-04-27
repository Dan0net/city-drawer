import { create } from 'zustand';

export interface UiState {
  showGrid: boolean;
  showFps: boolean;
  showFrontages: boolean;
  toggleGrid: () => void;
  toggleFps: () => void;
  toggleFrontages: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  showGrid: true,
  showFps: true,
  showFrontages: false,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleFps: () => set((s) => ({ showFps: !s.showFps })),
  toggleFrontages: () => set((s) => ({ showFrontages: !s.showFrontages })),
}));
