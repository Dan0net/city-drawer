import { useEffect, useRef } from 'react';
import { createPixiApp } from '@render/pixi/PixiApp';
import { Viewport } from '@render/pixi/Viewport';
import { DebugGridLayer } from '@render/layers/DebugGridLayer';
import { EdgesLayer } from '@render/layers/EdgesLayer';
import { GhostLayer } from '@render/layers/GhostLayer';
import { BuildingsLayer } from '@render/layers/BuildingsLayer';
import { AvailableFrontagesLayer } from '@render/layers/AvailableFrontagesLayer';
import { CellMapLayer } from '@render/layers/CellMapLayer';
import { DemandRoadOverlayLayer } from '@render/layers/DemandRoadOverlayLayer';
import { createTickLoop } from '@game/core/tickLoop';
import { useCameraStore } from '@game/store/cameraStore';
import { useUiStore } from '@game/store/uiStore';
import { useWorldStore } from '@game/store/worldStore';

const SNAP_PX = 12;

export function CanvasHost({ onFps }: { onFps?: (fps: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onFpsRef = useRef(onFps);
  onFpsRef.current = onFps;

  useEffect(() => {
    const container = containerRef.current!;
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const handle = await createPixiApp(canvas);
      if (cancelled) {
        handle.destroy();
        return;
      }

      const viewport = new Viewport(canvas, handle.world);
      const grid = new DebugGridLayer(viewport);
      const cellMap = new CellMapLayer();
      const buildings = new BuildingsLayer();
      const edges = new EdgesLayer();
      const demandRoadOverlay = new DemandRoadOverlayLayer();
      const frontages = new AvailableFrontagesLayer();
      const ghost = new GhostLayer();
      handle.world.addChild(grid.container);
      handle.world.addChild(cellMap.container);
      handle.world.addChild(buildings.container);
      handle.world.addChild(edges.container);
      handle.world.addChild(demandRoadOverlay.container);
      handle.world.addChild(frontages.container);
      handle.world.addChild(ghost.container);

      grid.setVisible(useUiStore.getState().showGrid);
      frontages.setVisible(useUiStore.getState().showFrontages);
      const unsubUi = useUiStore.subscribe((s) => {
        grid.setVisible(s.showGrid);
        frontages.setVisible(s.showFrontages);
      });

      const resizeObserver = new ResizeObserver(() => viewport.onResize());
      resizeObserver.observe(container);

      // ---------- input ----------
      const pointer = {
        panning: false,
        lastX: 0,
        lastY: 0,
        spaceDown: false,
        downButton: -1,
        downX: 0,
        downY: 0,
        moved: false,
      };

      // 'grabbing' while a pan drag is active, 'grab' when no tool is selected
      // (so the user knows clicking-and-dragging will pan), default otherwise.
      const updateCursor = () => {
        if (pointer.panning) {
          canvas.style.cursor = 'grabbing';
          return;
        }
        const tool = useWorldStore.getState().tool;
        if (tool === 'none' || pointer.spaceDown) {
          canvas.style.cursor = 'grab';
          return;
        }
        canvas.style.cursor = '';
      };

      const startPan = (e: PointerEvent) => {
        pointer.panning = true;
        pointer.lastX = e.clientX;
        pointer.lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        updateCursor();
        e.preventDefault();
      };

      const onPointerDown = (e: PointerEvent) => {
        pointer.downButton = e.button;
        pointer.downX = e.clientX;
        pointer.downY = e.clientY;
        pointer.moved = false;

        // Always-pan inputs (work regardless of tool)
        if (e.button === 1 || (e.button === 0 && pointer.spaceDown)) {
          startPan(e);
          return;
        }
        if (e.button !== 0) return;

        const tool = useWorldStore.getState().tool;
        if (tool === 'none') {
          startPan(e);
          return;
        }
        // Road/path/bulldoze: action happens on pointerup (so accidental drags don't fire).
      };

      const onPointerMove = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        if (pointer.panning) {
          const dx = e.clientX - pointer.lastX;
          const dy = e.clientY - pointer.lastY;
          pointer.lastX = e.clientX;
          pointer.lastY = e.clientY;
          const { zoom } = useCameraStore.getState();
          useCameraStore.getState().panBy(-dx / zoom, -dy / zoom);
        }

        if (pointer.downButton === 0) {
          const ddx = e.clientX - pointer.downX;
          const ddy = e.clientY - pointer.downY;
          if (ddx * ddx + ddy * ddy > 16) pointer.moved = true;
        }

        const w = viewport.screenToWorld(sx, sy);
        const zoom = useCameraStore.getState().zoom;
        useWorldStore.getState().setPointer(w.x, w.y, SNAP_PX / zoom, {
          snapDraw: useUiStore.getState().snapDraw,
        });
      };

      const onPointerUp = (e: PointerEvent) => {
        const wasButton = pointer.downButton;
        const moved = pointer.moved;
        pointer.downButton = -1;

        if (pointer.panning) {
          pointer.panning = false;
          if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
          updateCursor();
          return;
        }

        if (wasButton !== 0 || moved) return;

        // Treat as a click. Refresh snap at exactly this point first.
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const w = viewport.screenToWorld(sx, sy);
        const zoom = useCameraStore.getState().zoom;
        useWorldStore.getState().setPointer(w.x, w.y, SNAP_PX / zoom, {
          snapDraw: useUiStore.getState().snapDraw,
        });

        const tool = useWorldStore.getState().tool;
        if (tool === 'road' || tool === 'small_road' || tool === 'path') {
          useWorldStore.getState().beginOrCommitDraw(tool);
        } else if (tool === 'bulldoze') {
          useWorldStore.getState().removeAtPointer();
        }
      };

      const onPointerLeave = () => useWorldStore.getState().clearPointer();

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.0015);
        useCameraStore
          .getState()
          .zoomAt(sx, sy, factor, viewport.width(), viewport.height());
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !pointer.spaceDown) {
          pointer.spaceDown = true;
          updateCursor();
        }
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const k = e.key.toLowerCase();
        if (k === 'g') useUiStore.getState().toggleGrid();
        else if (k === 'f') useUiStore.getState().toggleFrontages();
        else if (k === 's') useUiStore.getState().toggleSnapDraw();
        else if (k === '`') useUiStore.getState().toggleFps();
        else if (k === 'r') useCameraStore.getState().reset();
        else if (k === '1') useWorldStore.getState().toggleTool('road');
        else if (k === '2') useWorldStore.getState().toggleTool('small_road');
        else if (k === '3') useWorldStore.getState().toggleTool('path');
        else if (k === '0') useWorldStore.getState().setTool('none');
        else if (k === 'b') useWorldStore.getState().toggleTool('bulldoze');
        else if (k === 'p') useWorldStore.getState().togglePause();
        else if (k === 'm') {
          const ids = useWorldStore.getState().demandMaps.map((m) => m.id);
          useUiStore.getState().cycleDemandMap(ids);
        }
        else if (k === 'escape') useWorldStore.getState().cancelDraw();
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
          pointer.spaceDown = false;
          updateCursor();
        }
      };

      const onContextMenu = (e: MouseEvent) => e.preventDefault();

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('pointerleave', onPointerLeave);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('contextmenu', onContextMenu);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      // Cursor reflects pan-readiness: subscribed here so we react to tool
      // changes from anywhere (toolbar clicks, hotkeys, escape). Also seed
      // the initial cursor based on starting tool.
      updateCursor();
      const unsubWorld = useWorldStore.subscribe((s, prev) => {
        if (s.tool !== prev.tool) updateCursor();
      });

      // ---------- sim tick (progress + spawner) ----------
      const simLoop = createTickLoop({ hz: 30 });
      simLoop.subscribe((dt) => {
        useWorldStore.getState().simStep(dt);
      });
      simLoop.start();

      // ---------- per-frame ----------
      let fpsAcc = 0;
      let fpsFrames = 0;
      let lastFpsEmit = performance.now();
      const tick = () => {
        grid.update();
        cellMap.update();
        buildings.update();
        edges.update();
        demandRoadOverlay.update();
        frontages.update();
        ghost.update();

        fpsFrames += 1;
        fpsAcc += handle.app.ticker.deltaMS;
        const now = performance.now();
        if (now - lastFpsEmit > 250) {
          const fps = (fpsFrames * 1000) / fpsAcc;
          onFpsRef.current?.(fps);
          fpsAcc = 0;
          fpsFrames = 0;
          lastFpsEmit = now;
        }
      };
      handle.app.ticker.add(tick);

      cleanup = () => {
        unsubUi();
        unsubWorld();
        resizeObserver.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        handle.app.ticker.remove(tick);
        simLoop.stop();
        viewport.destroy();
        handle.destroy();
        if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}
