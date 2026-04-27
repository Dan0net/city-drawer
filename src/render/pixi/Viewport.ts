import type { Container } from 'pixi.js';
import { useCameraStore } from '@game/store/cameraStore';
import type { Vec2 } from '@lib/math';
import type { AABB } from '@lib/aabb';

// Drives a Pixi Container's transform from the camera store and exposes
// world<->screen helpers for input handlers.
//
// We read CSS-pixel dims directly from the canvas DOM element rather than from
// the Pixi renderer. Pixi v8's `renderer.width` semantics aren't worth depending
// on; canvas.clientWidth/clientHeight is unambiguously CSS px and matches what
// pointer events and getBoundingClientRect see, so input ↔ render stays
// consistent (correct origin, correct zoom-to-cursor, no grid clipping).
export class Viewport {
  private unsubscribe?: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: Container,
  ) {
    this.apply();
    this.unsubscribe = useCameraStore.subscribe(() => this.apply());
  }

  destroy(): void {
    this.unsubscribe?.();
  }

  width(): number {
    return this.canvas.clientWidth;
  }

  height(): number {
    return this.canvas.clientHeight;
  }

  private apply(): void {
    const { cx, cy, zoom } = useCameraStore.getState();
    const w = this.width();
    const h = this.height();
    this.world.scale.set(zoom);
    this.world.position.set(w / 2 - cx * zoom, h / 2 - cy * zoom);
  }

  onResize(): void {
    this.apply();
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    const { cx, cy, zoom } = useCameraStore.getState();
    const w = this.width();
    const h = this.height();
    return { x: cx + (sx - w / 2) / zoom, y: cy + (sy - h / 2) / zoom };
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    const { cx, cy, zoom } = useCameraStore.getState();
    const w = this.width();
    const h = this.height();
    return { x: (wx - cx) * zoom + w / 2, y: (wy - cy) * zoom + h / 2 };
  }

  visibleBounds(): AABB {
    const { cx, cy, zoom } = useCameraStore.getState();
    const w = this.width();
    const h = this.height();
    const halfW = w / 2 / zoom;
    const halfH = h / 2 / zoom;
    return { minX: cx - halfW, minY: cy - halfH, maxX: cx + halfW, maxY: cy + halfH };
  }
}
