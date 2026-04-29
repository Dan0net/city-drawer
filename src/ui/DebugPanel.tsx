import { useState, type CSSProperties } from 'react';
import { useDebugStore, type SpawnEvent } from '@game/store/debugStore';
import { useWorldStore } from '@game/store/worldStore';
import { DEMAND_TYPES, type DemandDef } from '@game/demand/types';
import { previewPool } from '@game/sim/picker';
import type { Building } from '@game/buildings';

type Tab = 'events' | 'demand' | 'pool';

const PANEL: CSSProperties = {
  position: 'absolute',
  bottom: 8,
  right: 8,
  zIndex: 10,
  width: 360,
  background: 'rgba(11, 14, 19, 0.92)',
  border: '1px solid #1c2330',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#aab4c2',
};
const HEADER: CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid #1c2330',
};
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
const BODY: CSSProperties = {
  height: 240,
  overflowY: 'auto',
  padding: 8,
  lineHeight: 1.5,
};
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
        {(['events', 'demand', 'pool'] as Tab[]).map((t) => (
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
          {tab === 'pool' && <PoolTab />}
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

function EventRow({ e }: { e: SpawnEvent }) {
  const t = `${e.t.toFixed(1)}s`;
  if (e.ok) {
    return (
      <div style={{ ...ROW, color: '#86d99a' }}>
        <span style={{ width: 44, color: '#566273' }}>{t}</span>
        <span style={{ width: 10 }}>✓</span>
        <span style={{ whiteSpace: 'normal' }}>
          {e.sinkType} · {e.demandId} · <AttributionDetail e={e} />
        </span>
      </div>
    );
  }
  return (
    <div style={{ ...ROW, color: '#e57373' }}>
      <span style={{ width: 44, color: '#566273' }}>{t}</span>
      <span style={{ width: 10 }}>✗</span>
      <span>
        {e.sinkType} · <span style={{ color: '#aab4c2' }}>{e.reason}</span>
      </span>
    </div>
  );
}

function AttributionDetail({ e }: { e: SpawnEvent & { ok: true } }) {
  // Cell-sourced (factory consumes resource cells under its footprint).
  if (e.sourceType === 'cells') {
    return <span style={{ color: '#aab4c2' }}>consumed cells</span>;
  }
  // 1:1 attribution — show the SOURCE's post-fill state, which is what the
  // user wants to see ("this house took 1 of factory#3's 8 jobs → now 1/8").
  if (e.targetCount === 1) {
    const a = e.attributions[0];
    if (!a) return <span style={{ color: '#7a8493' }}>no source found</span>;
    return (
      <span style={{ color: '#aab4c2' }}>
        {e.sourceType}#{a.sourceId} {a.filledAfter}/{e.sourceCapacity}
      </span>
    );
  }
  // 1:N attribution — show how many of the target slots were filled, plus a
  // brief look at one source's state as a sanity check.
  const sample = e.attributions[0];
  return (
    <span style={{ color: '#aab4c2' }}>
      {e.attributions.length}/{e.targetCount} {e.sourceType}
      {sample && (
        <span style={{ color: '#7a8493' }}>
          {' '}(e.g. #{sample.sourceId} {sample.filledAfter}/{e.sourceCapacity})
        </span>
      )}
    </span>
  );
}

function DemandTab() {
  // Re-render on graph/buildings/demand-map updates so utilization stays live.
  useWorldStore((s) => s.demandMapsVersion);
  const buildings = useWorldStore((s) => s.buildings);
  const demandMaps = useWorldStore((s) => s.demandMaps);

  return (
    <>
      <div style={HEAD_ROW}>
        <span style={{ width: 70 }}>demand</span>
        <span style={{ width: 60 }}>src/cap</span>
        <span style={{ width: 40 }}>sinks</span>
        <span style={{ width: 50 }}>fldMax</span>
        <span style={{ width: 40 }}>thr</span>
        <span style={{ width: 30 }}>w</span>
      </div>
      {DEMAND_TYPES.map((def) => {
        const stat = computeDemandStat(def, buildings, demandMaps);
        return (
          <div key={def.id} style={ROW}>
            <span style={{ width: 70, color: '#eaf2ff' }}>{def.id}</span>
            <span style={{ width: 60 }}>{stat.sourceLabel}</span>
            <span style={{ width: 40 }}>{stat.sinkCount}</span>
            <span
              style={{
                width: 50,
                color: stat.fieldMax >= def.threshold ? '#86d99a' : '#7a8493',
              }}
            >
              {stat.fieldMax.toFixed(2)}
            </span>
            <span style={{ width: 40 }}>{def.threshold}</span>
            <span style={{ width: 30 }}>{def.weight}</span>
          </div>
        );
      })}
    </>
  );
}

interface DemandStat {
  sourceLabel: string;
  sinkCount: number;
  fieldMax: number;
}

function computeDemandStat(
  def: DemandDef,
  buildings: Building[],
  demandMaps: ReturnType<typeof useWorldStore.getState>['demandMaps'],
): DemandStat {
  let sourceLabel = '—';
  if (def.source.kind === 'building') {
    const sourceType = def.source.type;
    const cap = def.source.capacity;
    let count = 0;
    let totalCap = 0;
    let totalFilled = 0;
    for (const b of buildings) {
      if (b.type !== sourceType) continue;
      count++;
      totalCap += cap;
      totalFilled += b.filled?.[def.id] ?? 0;
    }
    sourceLabel = totalCap > 0 ? `${totalFilled}/${totalCap}` : `${count} src`;
  } else {
    sourceLabel = 'cells';
  }
  let sinkCount = 0;
  for (const b of buildings) if (b.type === def.sink.type) sinkCount++;
  const map = demandMaps.find((m) => m.id === def.id);
  let fieldMax = 0;
  if (map) for (const v of map.roadField.values()) if (v > fieldMax) fieldMax = v;
  return { sourceLabel, sinkCount, fieldMax };
}

function PoolTab() {
  useWorldStore((s) => s.demandMapsVersion);
  const graph = useWorldStore((s) => s.graph);
  const demandMaps = useWorldStore((s) => s.demandMaps);
  const candidates = previewPool(graph, DEMAND_TYPES, demandMaps);

  if (candidates.length === 0) {
    return (
      <div style={{ color: '#566273' }}>
        pool empty — no edge clears any demand's threshold
      </div>
    );
  }
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  const top = candidates.slice(0, 12);

  return (
    <>
      <div style={{ marginBottom: 4, color: '#566273' }}>
        {candidates.length} candidates · Σ weight {total.toFixed(2)}
      </div>
      <div style={HEAD_ROW}>
        <span style={{ width: 80 }}>demand</span>
        <span style={{ width: 50 }}>edge</span>
        <span style={{ width: 50 }}>score</span>
        <span style={{ width: 50 }}>weight</span>
        <span style={{ width: 40 }}>p%</span>
      </div>
      {top.map((c) => (
        <div key={`${c.def.id}:${c.edgeId}`} style={ROW}>
          <span style={{ width: 80, color: '#eaf2ff' }}>{c.def.id}</span>
          <span style={{ width: 50 }}>#{c.edgeId}</span>
          <span style={{ width: 50 }}>{c.score.toFixed(2)}</span>
          <span style={{ width: 50 }}>{c.weight.toFixed(2)}</span>
          <span style={{ width: 40, color: '#86d99a' }}>
            {((c.weight / total) * 100).toFixed(1)}
          </span>
        </div>
      ))}
    </>
  );
}
