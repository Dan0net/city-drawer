import { Application, Container } from 'pixi.js';

export interface PixiAppHandle {
  app: Application;
  world: Container; // transformed by viewport
  overlay: Container; // screen-space overlays (debug, ghost in screen-coords if needed)
  destroy(): void;
}

export async function createPixiApp(canvas: HTMLCanvasElement): Promise<PixiAppHandle> {
  const app = new Application();
  await app.init({
    canvas,
    background: '#0b0e13',
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    resizeTo: canvas.parentElement ?? window,
    powerPreference: 'high-performance',
  });

  const world = new Container();
  world.label = 'world';
  app.stage.addChild(world);

  const overlay = new Container();
  overlay.label = 'overlay';
  app.stage.addChild(overlay);

  return {
    app,
    world,
    overlay,
    destroy() {
      app.destroy(true, { children: true });
    },
  };
}
