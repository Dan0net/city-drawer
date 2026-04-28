import type { CSSProperties } from 'react';
import { useCameraStore } from '@game/store/cameraStore';
import { useUiStore } from '@game/store/uiStore';
import { useWorldStore } from '@game/store/worldStore';
import type { Tool } from '@game/store/worldStore';

const baseBtn: CSSProperties = {
  padding: '6px 10px',
  background: '#1a212d',
  color: '#d8dde6',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#2a3445',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
};

const activeBtn: CSSProperties = {
  ...baseBtn,
  background: '#2d4a7a',
  borderColor: '#4a90ff',
  color: '#eaf2ff',
};

function ToolButton({
  tool,
  label,
  hotkey,
}: {
  tool: Exclude<Tool, 'none'>;
  label: string;
  hotkey: string;
}) {
  const active = useWorldStore((s) => s.tool === tool);
  const toggle = useWorldStore((s) => s.toggleTool);
  return (
    <button
      style={active ? activeBtn : baseBtn}
      onClick={() => toggle(tool)}
      title={`${label} (${hotkey})`}
    >
      {label} <span style={{ opacity: 0.6 }}>{hotkey}</span>
    </button>
  );
}

function ActionButton({
  label,
  hotkey,
  onClick,
  active = false,
  title,
}: {
  label: string;
  hotkey?: string;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      style={active ? activeBtn : baseBtn}
      onClick={onClick}
      title={title ?? (hotkey ? `${label} (${hotkey})` : label)}
    >
      {label}
      {hotkey && <span style={{ opacity: 0.6 }}> {hotkey}</span>}
    </button>
  );
}

export function Toolbar() {
  const showGrid = useUiStore((s) => s.showGrid);
  const toggleGrid = useUiStore((s) => s.toggleGrid);
  const showFrontages = useUiStore((s) => s.showFrontages);
  const toggleFrontages = useUiStore((s) => s.toggleFrontages);
  const snapDraw = useUiStore((s) => s.snapDraw);
  const toggleSnapDraw = useUiStore((s) => s.toggleSnapDraw);
  const activeDemandMap = useUiStore((s) => s.activeDemandMap);
  const setDemandMap = useUiStore((s) => s.setDemandMap);
  const demandMaps = useWorldStore((s) => s.demandMaps);
  const reset = useCameraStore((s) => s.reset);
  const clearAll = useWorldStore((s) => s.clearAll);
  const clearBuildings = useWorldStore((s) => s.clearBuildings);
  const paused = useWorldStore((s) => s.paused);
  const togglePause = useWorldStore((s) => s.togglePause);

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        display: 'flex',
        gap: 6,
        zIndex: 10,
        background: 'rgba(11, 14, 19, 0.7)',
        padding: 6,
        borderRadius: 6,
        border: '1px solid #1c2330',
      }}
    >
      <ToolButton tool="road" label="Road" hotkey="1" />
      <ToolButton tool="small_road" label="Small road" hotkey="2" />
      <ToolButton tool="path" label="Path" hotkey="3" />
      <ToolButton tool="bulldoze" label="Bulldoze" hotkey="B" />
      <div style={{ width: 1, background: '#2a3445', margin: '0 2px' }} />
      <ActionButton
        label={paused ? 'Paused' : 'Pause'}
        hotkey="P"
        active={paused}
        onClick={() => togglePause()}
        title="Pause / resume sim (P)"
      />
      <ActionButton label="Reset" hotkey="R" onClick={() => reset()} title="Reset camera (R)" />
      <ActionButton
        label="Grid"
        hotkey="G"
        active={showGrid}
        onClick={() => toggleGrid()}
        title="Toggle grid (G)"
      />
      <ActionButton
        label="Frontages"
        hotkey="F"
        active={showFrontages}
        onClick={() => toggleFrontages()}
        title="Toggle available road frontages overlay (F)"
      />
      <ActionButton
        label="Snap"
        hotkey="S"
        active={snapDraw}
        onClick={() => toggleSnapDraw()}
        title="Snap drawing to 45° angles and 10m increments (S)"
      />
      <label
        title="Demand overlay (M cycles)"
        style={{
          ...(activeDemandMap ? activeBtn : baseBtn),
          padding: 0,
          display: 'inline-flex',
          alignItems: 'stretch',
          cursor: 'pointer',
        }}
      >
        <span style={{ padding: '6px 6px 6px 10px' }}>
          Map <span style={{ opacity: 0.6 }}>M</span>
        </span>
        <select
          value={activeDemandMap ?? ''}
          onChange={(e) => setDemandMap(e.target.value === '' ? null : e.target.value)}
          style={{
            background: 'transparent',
            color: 'inherit',
            border: 'none',
            padding: '6px 8px 6px 4px',
            font: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="">off</option>
          {demandMaps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <ActionButton
        label="Clear bldgs"
        onClick={() => clearBuildings()}
        title="Demolish every building, keep roads & paths"
      />
      <ActionButton
        label="Clear all"
        onClick={() => clearAll()}
        title="Clear roads, paths, and buildings"
      />
    </div>
  );
}
