import { useState, type CSSProperties } from 'react';
import { useDebugStore, type SpawnEvent } from '@game/store/debugStore';
import { useWorldStore } from '@game/store/worldStore';
import { DEMAND_TYPES } from '@game/demand/types';
import { globalAvail, previewField } from '@game/sim/picker';
import { EXP_DEMAND, EXP_LOCATION } from '@game/sim/config';

type Tab = 'events' | 'demand' | 'field';

const PANEL: CSSProperties = {
  position: 'absolute',
  bottom: 8,
  right: 8,
  zIndex: 10,
  width: 380,
  background: 'rgba(11, 14, 19, 0.92)',
  border: '1px solid #1c2330',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#aab4c2',
};
const HEADER: CSSProperties = { display: 'flex', borderBottom: '1px solid #1c2330' };
const TAB_BTN_BASE: CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  background: 'transparent',
  color: '#7a8493',
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'inherit',
};
const TAB_BTN_ACTIVE: CSSProperties = {
  ...TAB_BTN_BASE,
  color: '#eaf2ff',
  background: '#1a212d',
  borderBottom: '2px solid #4a90ff',
};
const BODY: CSSProperties = { height: 240, overflowY: 'auto', padding: 8, lineHeight: 1.5 };
const ROW: CSSProperties = {
  display: 'flex',
  gap: 8,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};
const HEAD_ROW: CSSProperties = {
  ...ROW,
  color: '#566273',
  borderBottom: '1px solid #1c2330',
  paddingBottom: 4,
  marginBottom: 4,
};

export function DebugPanel() {
  const [tab, setTab] = useState<Tab>('events');
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={PANEL}>
      <div style={HEADER}>
        {(['events', 'demand', 'field'] as Tab[]).map((t) => (
          <button
            key={t}
            style={tab === t ? TAB_BTN_ACTIVE : TAB_BTN_BASE}
            onClick={() => {
              setTab(t);
              setCollapsed(false);
            }}
          >
            {t}
          </button>
        ))}
        <button
          style={{ ...TAB_BTN_BASE, flex: 0, padding: '6px 10px' }}
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'expand' : 'collapse'}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>
      {!collapsed && (
        <div style={BODY}>
          {tab === 'events' && <EventsTab />}
          {tab === 'demand' && <DemandTab />}
          {tab === 'field' && <FieldTab />}
        </div>
      )}
    </div>
  );
}

function EventsTab() {
  const events = useDebugStore((s) => s.events);
  const clear = useDebugStore((s) => s.clear);
  if (events.length === 0) {
    return <div style={{ color: '#566273' }}>no events yet — draw some roads</div>;
  }
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: '#566273' }}>{events.length} events</span>
        <button
          style={{
            background: 'transparent',
            border: 'none',
            color: '#7a8493',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'inherit',
            padding: 0,
          }}
          onClick={clear}
        >
          clear
        </button>
      </div>
      {events.map((e) => (
        <EventRow key={e.id} e={e} />
      ))}
    </>
  );
}

const TIME_COL: CSSProperties = { width: 44, color: '#566273' };
const ICON_COL: CSSProperties = { width: 10 };

function EventRow({ e }: { e: SpawnEvent }) {
  const t = `${e.t.toFixed(1)}s`;
  switch (e.kind) {
    case 'success': {
      const partial = e.slotsClaimed < e.slotsDemanded;
      return (
        <div style={{ ...ROW, color: partial ? '#e3c364' : '#86d99a' }}>
          <span style={TIME_COL}>{t}</span>
          <span style={ICON_COL}>{partial ? '◐' : '✓'}</span>
          <span style={{ whiteSpace: 'normal' }}>
            {e.sinkType}#{e.sinkId} · {e.demandId} ·{' '}
            <span style={{ color: '#aab4c2' }}>
              {e.slotsClaimed}/{e.slotsDemanded} slots
            </span>
          </span>
        </div>
      );
    }
    case 'physical_failure':
      return (
        <div style={{ ...ROW, color: '#e57373' }}>
          <span style={TIME_COL}>{t}</span>
          <span style={ICON_COL}>✗</span>
          <span>
            {e.sinkType} · <span style={{ color: '#aab4c2' }}>{e.reason}</span>
          </span>
        </div>
      );
    case 'no_spawnable_demand':
      return (
        <div style={{ ...ROW, color: '#566273' }}>
          <span style={TIME_COL}>{t}</span>
          <span style={ICON_COL}>—</span>
          <span>no spawnable demand this tick</span>
        </div>
      );
  }
}

function DemandTab() {
  // Re-render on graph/buildings/demand-map updates.
  useWorldStore((s) => s.demandMapsVersion);
  useWorldStore((s) => s.attributionsVersion);
  const buildings = useWorldStore((s) => s.buildings);
  const demandMaps = useWorldStore((s) => s.demandMaps);
  const ledgers = useWorldStore((s) => s.attributions);

  return (
    <>
      <div style={{ marginBottom: 4, color: '#566273' }}>
        EXP_DEMAND={EXP_DEMAND} · EXP_LOCATION={EXP_LOCATION}
      </div>
      <div style={HEAD_ROW}>
        <span style={{ width: 70 }}>demand</span>
        <span style={{ width: 30 }}>srcs</span>
        <span style={{ width: 35 }}>sinks</span>
        <span style={{ width: 50 }}>cap</span>
        <span style={{ width: 50 }}>filled</span>
        <span style={{ width: 50 }}>avail</span>
        <span style={{ width: 50 }}>fldMax</span>
      </div>
      {DEMAND_TYPES.map((def) => {
        const stat = globalAvail(def, buildings, demandMaps, ledgers);
        const map = demandMaps.find((m) => m.id === def.id);
        let fldMax = 0;
        if (map) for (const v of map.roadField.values()) if (v > fldMax) fldMax = v;
        let srcCount = 0;
        if (def.source.kind === 'building') {
          for (const b of buildings) if (b.type === def.source.type) srcCount++;
        }
        let sinkCount = 0;
        for (const b of buildings) if (b.type === def.sink.type) sinkCount++;
        return (
          <div key={def.id} style={ROW}>
            <span style={{ width: 70, color: '#eaf2ff' }}>{def.id}</span>
            <span style={{ width: 30 }}>{def.source.kind === 'building' ? srcCount : '—'}</span>
            <span style={{ width: 35 }}>{sinkCount}</span>
            <span style={{ width: 50 }}>{fmt(stat.cap)}</span>
            <span style={{ width: 50 }}>{fmt(stat.filled)}</span>
            <span style={{ width: 50, color: stat.avail < 0 ? '#e57373' : '#aab4c2' }}>
              {fmt(stat.avail)}
            </span>
            <span style={{ width: 50 }}>{fmt(fldMax)}</span>
          </div>
        );
      })}
    </>
  );
}

const fmt = (n: number): string => (Math.abs(n) < 100 ? n.toFixed(2) : n.toFixed(0));

function FieldTab() {
  useWorldStore((s) => s.demandMapsVersion);
  const graph = useWorldStore((s) => s.graph);
  const demandMaps = useWorldStore((s) => s.demandMaps);
  const rows = previewField(graph, DEMAND_TYPES, demandMaps);

  if (rows.length === 0) {
    return (
      <div style={{ color: '#566273' }}>no nodes with non-zero field — draw some roads</div>
    );
  }
  const top = rows.slice(0, 14);

  return (
    <>
      <div style={{ marginBottom: 4, color: '#566273' }}>
        {rows.length} active nodes · top {top.length}
      </div>
      <div style={HEAD_ROW}>
        <span style={{ width: 50 }}>node</span>
        {DEMAND_TYPES.map((d) => (
          <span key={d.id} style={{ width: 64 }}>
            {d.id.slice(0, 7)}
          </span>
        ))}
      </div>
      {top.map((r) => (
        <div key={r.nodeId} style={ROW}>
          <span style={{ width: 50 }}>#{r.nodeId}</span>
          {DEMAND_TYPES.map((d) => {
            const v = r.values[d.id] ?? 0;
            return (
              <span key={d.id} style={{ width: 64, color: v > 0 ? '#86d99a' : '#566273' }}>
                {v > 0 ? v.toFixed(2) : '·'}
              </span>
            );
          })}
        </div>
      ))}
    </>
  );
}
