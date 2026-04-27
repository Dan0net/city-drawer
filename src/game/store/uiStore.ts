import { create } from 'zustand';

export interface UiState {
  showGrid: boolean;
  showFps: boolean;
  toggleGrid: () => void;
  toggleFps: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  showGrid: true,
  showFps: true,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleFps: () => set((s) => ({ showFps: !s.showFps })),
}));
