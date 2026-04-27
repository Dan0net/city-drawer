import type { CSSProperties } from 'react';
import { useCameraStore } from '@game/store/cameraStore';
import { useUiStore } from '@game/store/uiStore';
import { useWorldStore } from '@game/store/worldStore';
import type { Tool } from '@game/store/worldStore';

const baseBtn: CSSProperties = {
  padding: '6px 10px',
  background: '#1a212d',
  color: '#d8dde6',
  border: '1px solid #2a3445',
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

export function Toolbar() {
  const showGrid = useUiStore((s) => s.showGrid);
  const toggleGrid = useUiStore((s) => s.toggleGrid);
  const reset = useCameraStore((s) => s.reset);
  const clearAll = useWorldStore((s) => s.clearAll);

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
      <ToolButton tool="path" label="Path" hotkey="2" />
      <ToolButton tool="bulldoze" label="Bulldoze" hotkey="B" />
      <div style={{ width: 1, background: '#2a3445', margin: '0 2px' }} />
      <button style={baseBtn} onClick={() => reset()} title="Reset camera (R)">
        Reset
      </button>
      <button
        style={showGrid ? activeBtn : baseBtn}
        onClick={() => toggleGrid()}
        title="Toggle grid (G)"
      >
        Grid
      </button>
      <button style={baseBtn} onClick={() => clearAll()} title="Clear all roads & paths">
        Clear
      </button>
    </div>
  );
}
