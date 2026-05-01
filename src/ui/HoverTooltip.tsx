import { useEffect, useState, type CSSProperties } from 'react';
import type { Building, BuildingType } from '@game/buildings';
import type { Graph, EdgeId, NodeId } from '@game/graph';
import { useWorldStore } from '@game/store/worldStore';
import { DEMAND_TYPES, type DemandDef } from '@game/demand/types';
import type { DemandMap } from '@game/demand/maps';
import {
  sinkSlotDemand,
  slotsClaimedBy,
  slotsGivenBy,
  type AttributionLedgers,
} from '@game/sim/attribution';

const TOOLTIP: CSSProperties = {
  position: 'fixed',
  zIndex: 20,
  background: 'rgba(11, 14, 19, 0.95)',
  border: '1px solid #1c2330',
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#aab4c2',
  lineHeight: 1.5,
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};
const HEADER: CSSProperties = { color: '#eaf2ff', marginBottom: 2 };
const ROW: CSSProperties = { display: 'flex', gap: 8 };
const KEY: CSSProperties = { width: 80, color: '#7a8493' };

const fmt = (n: number): string => (Math.abs(n) < 100 ? n.toFixed(2) : n.toFixed(0));

export function HoverTooltip() {
  const tool = useWorldStore((s) => s.tool);
  const hoverInfo = useWorldStore((s) => s.hoverInfo);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (tool !== 'none') {
      setPos(null);
      return;
    }
    const onMove = (e: MouseEvent): void => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [tool]);

  if (tool !== 'none' || !hoverInfo || !pos) return null;

  // Offset so the tooltip sits below-right of the cursor and doesn't trail
  // off the right edge of the viewport.
  const left = Math.min(pos.x + 14, window.innerWidth - 280);
  const top = pos.y + 14;

  return (
    <div style={{ ...TOOLTIP, left, top }}>
      {hoverInfo.kind === 'building' && <BuildingBody id={hoverInfo.id} />}
      {hoverInfo.kind === 'node' && <NodeBody id={hoverInfo.id} />}
      {hoverInfo.kind === 'edge' && <EdgeBody id={hoverInfo.id} />}
    </div>
  );
}

function BuildingBody({ id }: { id: number }) {
  useWorldStore((s) => s.demandMapsVersion);
  useWorldStore((s) => s.attributionsVersion);
  const buildings = useWorldStore((s) => s.buildings);
  const ledgers = useWorldStore((s) => s.attributions);
  const b = buildings.find((x) => x.id === id);
  if (!b) return <span style={{ color: '#566273' }}>building gone</span>;

  const sourceDefs = DEMAND_TYPES.filter(
    (d) => d.source.kind === 'building' && d.source.type === b.type,
  );
  const sinkDef = DEMAND_TYPES.find((d) => d.sink.type === b.type);

  return (
    <>
      <div style={HEADER}>
        {b.type} #{b.id}
      </div>
      <div style={ROW}>
        <span style={KEY}>area</span>
        <span>{b.area.toFixed(0)} m²</span>
      </div>
      {sourceDefs.length > 0 && (
        <>
          <div style={{ ...HEADER, marginTop: 4, fontSize: 10 }}>SOURCE</div>
          {sourceDefs.map((d) => (
            <SourceRow key={d.id} b={b} def={d} ledgers={ledgers} />
          ))}
        </>
      )}
      {sinkDef && sinkDef.source.kind === 'building' && (
        <>
          <div style={{ ...HEADER, marginTop: 4, fontSize: 10 }}>SINK</div>
          <SinkRow b={b} def={sinkDef} ledgers={ledgers} />
        </>
      )}
    </>
  );
}

function SourceRow({ b, def, ledgers }: { b: Building; def: DemandDef; ledgers: AttributionLedgers }) {
  if (def.source.kind !== 'building') return null;
  const cap = def.source.capacity;
  const ledger = ledgers.get(def.id);
  const filled = ledger ? slotsGivenBy(ledger, b.id) : 0;
  const avail = cap - filled;
  return (
    <div style={ROW}>
      <span style={KEY}>{def.id}</span>
      <span>
        filled {filled}/{cap} · avail{' '}
        <span style={{ color: avail <= 0 ? '#e57373' : '#86d99a' }}>{avail}</span>
      </span>
    </div>
  );
}

function SinkRow({ b, def, ledgers }: { b: Building; def: DemandDef; ledgers: AttributionLedgers }) {
  const ledger = ledgers.get(def.id);
  const claimed = ledger ? slotsClaimedBy(ledger, b.id) : 0;
  const demand = sinkSlotDemand(b, def);
  const partial = claimed < demand;
  return (
    <div style={ROW}>
      <span style={KEY}>{def.id}</span>
      <span>
        <span style={{ color: partial ? '#e3c364' : '#aab4c2' }}>
          {claimed}/{demand}
        </span>{' '}
        slots {sourceLabel(def)}
      </span>
    </div>
  );
}

const sourceLabel = (def: DemandDef): BuildingType | 'cells' =>
  def.source.kind === 'cells' ? 'cells' : def.source.type;

function NodeBody({ id }: { id: NodeId }) {
  useWorldStore((s) => s.demandMapsVersion);
  const graph = useWorldStore((s) => s.graph);
  const demandMaps = useWorldStore((s) => s.demandMaps);
  const node = graph.nodes.get(id);
  if (!node) return <span style={{ color: '#566273' }}>node gone</span>;
  return (
    <>
      <div style={HEADER}>node #{id}</div>
      <FieldRows fieldAt={(d) => fieldAtNode(d, id, demandMaps)} />
    </>
  );
}

function EdgeBody({ id }: { id: EdgeId }) {
  useWorldStore((s) => s.demandMapsVersion);
  const graph = useWorldStore((s) => s.graph);
  const demandMaps = useWorldStore((s) => s.demandMaps);
  const edge = graph.edges.get(id);
  if (!edge) return <span style={{ color: '#566273' }}>edge gone</span>;
  const len = edgeLength(graph, id);
  return (
    <>
      <div style={HEADER}>
        edge #{id} · {edge.kind} · {len.toFixed(0)} m
      </div>
      <FieldRows fieldAt={(d) => fieldAtEdge(d, id, graph, demandMaps)} />
    </>
  );
}

function FieldRows({ fieldAt }: { fieldAt: (d: DemandDef) => number }) {
  return (
    <>
      {DEMAND_TYPES.map((d) => {
        const v = fieldAt(d);
        return (
          <div key={d.id} style={ROW}>
            <span style={KEY}>{d.id}</span>
            <span style={{ color: v > 0 ? '#86d99a' : '#566273' }}>
              {v > 0 ? fmt(v) : '·'}
            </span>
          </div>
        );
      })}
    </>
  );
}

const fieldAtNode = (
  def: DemandDef,
  nodeId: NodeId,
  demandMaps: ReadonlyArray<DemandMap>,
): number => {
  const map = demandMaps.find((m) => m.id === def.id);
  return map?.roadField.get(nodeId) ?? 0;
};

const fieldAtEdge = (
  def: DemandDef,
  edgeId: EdgeId,
  graph: Graph,
  demandMaps: ReadonlyArray<DemandMap>,
): number => {
  const e = graph.edges.get(edgeId);
  if (!e) return 0;
  const map = demandMaps.find((m) => m.id === def.id);
  if (!map) return 0;
  const va = map.roadField.get(e.from) ?? 0;
  const vb = map.roadField.get(e.to) ?? 0;
  return (va + vb) * 0.5;
};

const edgeLength = (graph: Graph, edgeId: EdgeId): number => {
  const e = graph.edges.get(edgeId);
  if (!e) return 0;
  const a = graph.nodes.get(e.from);
  const b = graph.nodes.get(e.to);
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
};
