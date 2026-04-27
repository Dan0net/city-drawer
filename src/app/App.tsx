import { useState } from 'react';
import { CanvasHost } from '@ui/CanvasHost';
import { Toolbar } from '@ui/Toolbar';
import { Hud } from '@ui/Hud';

export function App() {
  const [fps, setFps] = useState(0);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <CanvasHost onFps={setFps} />
      <Toolbar />
      <Hud fps={fps} />
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          fontSize: 10,
          color: '#5a6473',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          padding: '4px 8px',
          background: 'rgba(11, 14, 19, 0.7)',
          borderRadius: 4,
          border: '1px solid #1c2330',
          lineHeight: 1.6,
        }}
      >
        1 road · 2 path · B bulldoze · 0 deselect · click+drag = pan when no tool · space/middle = pan always · wheel zoom · R reset · G grid · ` fps · Esc cancel draw
      </div>
    </div>
  );
}
