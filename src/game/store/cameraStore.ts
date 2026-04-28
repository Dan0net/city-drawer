import { create } from 'zustand';
import { clamp } from '@lib/math';

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 16;

interface CameraState {
  // World coordinate at the screen center
  cx: number;
  cy: number;
  // Pixels per world-meter
  zoom: number;

  setCamera: (cx: number, cy: number, zoom: number) => void;
  panBy: (dxWorld: number, dyWorld: number) => void;
  zoomAt: (
    screenX: number,
    screenY: number,
    factor: number,
    screenW: number,
    screenH: number,
  ) => void;
  reset: () => void;
}

export const useCameraStore = create<CameraState>((set, get) => ({
  cx: 0,
  cy: 0,
  zoom: 1,

  setCamera: (cx, cy, zoom) => set({ cx, cy, zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX) }),

  panBy: (dxWorld, dyWorld) => {
    const { cx, cy } = get();
    set({ cx: cx + dxWorld, cy: cy + dyWorld });
  },

  // Zoom toward a screen point: keeps the world point under the cursor stationary.
  zoomAt: (screenX, screenY, factor, screenW, screenH) => {
    const { cx, cy, zoom } = get();
    const newZoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
    if (newZoom === zoom) return;

    // World point under cursor before zoom
    const wx = cx + (screenX - screenW / 2) / zoom;
    const wy = cy + (screenY - screenH / 2) / zoom;

    // Solve for new center so that (wx, wy) maps back to (screenX, screenY)
    const newCx = wx - (screenX - screenW / 2) / newZoom;
    const newCy = wy - (screenY - screenH / 2) / newZoom;

    set({ cx: newCx, cy: newCy, zoom: newZoom });
  },

  reset: () => set({ cx: 0, cy: 0, zoom: 1 }),
}));
