import type { CSSProperties } from 'react';
import { useWorldStore } from '@game/store/worldStore';
import { useCameraStore } from '@game/store/cameraStore';
import { computeRoutes } from '@render/layers/HoverRoutesLayer';

const BADGE: CSSProperties = {
  position: 'absolute',
  background: 'rgba(11, 14, 19, 0.95)',
  border: '1px solid #1c2330',
  borderRadius: 3,
  padding: '1px 4px',
  fontSize: 10,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#aab4c2',
  lineHeight: 1.2,
  pointerEvents: 'none',
  fontVariantNumeric: 'tabular-nums',
  transform: 'translate(-50%, -50%)',
  whiteSpace: 'nowrap',
};

const TIP_OFFSET_PX = 12;

// DOM badges for HoverRoutesLayer slot counts. Pixi Text scales with the
// world transform and blurs at high zoom; DOM stays crisp. Mounted inside
// CanvasHost's container so absolute coords are already canvas-relative.
export function HoverRouteLabels({ width, height }: { width: number; height: number }) {
  const hoverInfo = useWorldStore((s) => s.hoverInfo);
  useWorldStore((s) => s.attributionsVersion);
  useWorldStore((s) => s.graphVersion);
  useWorldStore((s) => s.buildingsVersion);
  const cx = useCameraStore((s) => s.cx);
  const cy = useCameraStore((s) => s.cy);
  const zoom = useCameraStore((s) => s.zoom);

  if (!hoverInfo || hoverInfo.kind !== 'building' || width === 0 || height === 0) return null;
  const { graph, buildings, attributions } = useWorldStore.getState();
  const target = buildings.find((b) => b.id === hoverInfo.id);
  if (!target) return null;

  const { labels } = computeRoutes(target, graph, buildings, attributions);
  return (
    <>
      {labels.map((l, i) => {
        const sx = (l.wx - cx) * zoom + width / 2 + l.dirX * TIP_OFFSET_PX;
        const sy = (l.wy - cy) * zoom + height / 2 + l.dirY * TIP_OFFSET_PX;
        return (
          <div key={i} style={{ ...BADGE, left: sx, top: sy }}>
            {l.slots}
          </div>
        );
      })}
    </>
  );
}
