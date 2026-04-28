import { useCameraStore } from '@game/store/cameraStore';
import { useUiStore } from '@game/store/uiStore';
import { useWorldStore } from '@game/store/worldStore';

const TOOL_LABEL: Record<string, string> = {
  none: 'pan',
  road: 'road',
  path: 'path',
  bulldoze: 'bulldoze',
};

export function Hud({ fps }: { fps: number }) {
  const showFps = useUiStore((s) => s.showFps);
  const cx = useCameraStore((s) => s.cx);
  const cy = useCameraStore((s) => s.cy);
  const zoom = useCameraStore((s) => s.zoom);
  const tool = useWorldStore((s) => s.tool);
  const drawing = useWorldStore((s) => s.drawingStart != null);
  const activeDemandMap = useUiStore((s) => s.activeDemandMap);

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10,
        background: 'rgba(11, 14, 19, 0.7)',
        padding: '6px 10px',
        borderRadius: 6,
        border: '1px solid #1c2330',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: '#aab4c2',
        lineHeight: 1.5,
        minWidth: 160,
        textAlign: 'right',
      }}
    >
      {showFps && (
        <div style={{ color: fps >= 55 ? '#86d99a' : fps >= 30 ? '#e3c364' : '#e57373' }}>
          {fps.toFixed(1)} FPS
        </div>
      )}
      <div>
        tool {TOOL_LABEL[tool] ?? tool}
        {drawing ? ' · drawing' : ''}
      </div>
      <div>map {activeDemandMap ?? 'off'}</div>
      <div>
        x {cx.toFixed(1)} m
        <br />
        y {cy.toFixed(1)} m
        <br />
        zoom {zoom.toFixed(2)}×
      </div>
    </div>
  );
}
