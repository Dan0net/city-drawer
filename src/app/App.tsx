import { useState } from 'react';
import { CanvasHost } from '@ui/CanvasHost';
import { Toolbar } from '@ui/Toolbar';
import { Hud } from '@ui/Hud';
import { DebugPanel } from '@ui/DebugPanel';

export function App() {
  const [fps, setFps] = useState(0);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <CanvasHost onFps={setFps} />
      <Toolbar />
      <Hud fps={fps} />
      <DebugPanel />
    </div>
  );
}
