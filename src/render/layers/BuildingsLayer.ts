import { Container, Graphics } from 'pixi.js';
import type {
  Building,
  BuildingId,
  BuildingType,
  FailedAttempt,
  FailedAttemptId,
} from '@game/buildings';
import { BUILDING_COLORS } from '@game/buildings';
import { useWorldStore } from '@game/store/worldStore';
import { PERIMETER_EDGE_DURATION_S, FILL_DURATION_S } from '@game/sim/animation';

const STROKE_WIDTH = 1.2;
const DOT_RADIUS = 0.9;
const BULLDOZE = 0xe55050;
const INSPECT = 0xf5c542;
const FAIL_COLOR = 0xe55050;

interface Node {
  cont: Container;
  fill: Graphics;
  stroke: Graphics;
  localPoly: number[];
  strokeColor: number;
  numEdges: number;
  perimeterDuration: number;
  done: boolean;
}

export class BuildingsLayer {
  readonly container = new Container();
  private base = new Container();
  private preview = new Graphics();
  private hover = new Graphics();
  private buildingNodes = new Map<BuildingId, Node>();
  private failedNodes = new Map<FailedAttemptId, Node>();
  private lastBuildingsVersion = -1;
  private lastFailedVersion = -1;
  private lastHover: string | null = null;
  private lastPreviewKey = '';

  constructor() {
    this.container.label = 'buildings';
    this.container.addChild(this.base);
    this.container.addChild(this.preview);
    this.container.addChild(this.hover);
  }

  update(): void {
    const s = useWorldStore.getState();
    if (s.buildingsVersion !== this.lastBuildingsVersion) {
      this.lastBuildingsVersion = s.buildingsVersion;
      this.syncBuildingNodes(s.buildings);
    }
    if (s.failedAttemptsVersion !== this.lastFailedVersion) {
      this.lastFailedVersion = s.failedAttemptsVersion;
      this.syncFailedNodes(s.failedAttempts);
    }
    this.applyConfirmedAnimation(s.buildings, s.simTime);
    this.applyFailedAnimation(s.failedAttempts, s.simTime);

    const target =
      s.bulldozeHover?.kind === 'building'
        ? { mode: 'b' as const, id: s.bulldozeHover.id }
        : s.hoverInfo?.kind === 'building'
          ? { mode: 'i' as const, id: s.hoverInfo.id }
          : null;
    const hoverKey = target ? `${target.mode}:${target.id}` : null;
    if (hoverKey !== this.lastHover) {
      this.lastHover = hoverKey;
      this.drawHover();
    }

    // Recompute preview when its identity OR the underlying buildings change
    // (a bulldozed building drops out, polygons change, etc.).
    const previewKey = `${s.buildingsVersion}:${s.bulldozePreview.join(',')}`;
    if (previewKey !== this.lastPreviewKey) {
      this.lastPreviewKey = previewKey;
      this.drawPreview();
    }
  }

  private syncBuildingNodes(buildings: Building[]): void {
    const live = new Set<BuildingId>();
    for (const b of buildings) live.add(b.id);

    for (const [id, node] of this.buildingNodes) {
      if (live.has(id)) continue;
      this.base.removeChild(node.cont);
      node.cont.destroy({ children: true });
      this.buildingNodes.delete(id);
    }

    for (const b of buildings) {
      if (this.buildingNodes.has(b.id)) continue;
      const fillColor = BUILDING_COLORS[b.type];
      const strokeColor = darken(fillColor, 0.55);
      this.buildingNodes.set(
        b.id,
        this.makeNode(b.poly, b.centroid, strokeColor, fillColor, true, b.type),
      );
    }
  }

  private syncFailedNodes(failed: FailedAttempt[]): void {
    const live = new Set<FailedAttemptId>();
    for (const f of failed) live.add(f.id);

    for (const [id, node] of this.failedNodes) {
      if (live.has(id)) continue;
      this.base.removeChild(node.cont);
      node.cont.destroy({ children: true });
      this.failedNodes.delete(id);
    }

    for (const f of failed) {
      if (this.failedNodes.has(f.id)) continue;
      this.failedNodes.set(
        f.id,
        this.makeNode(f.poly, f.centroid, FAIL_COLOR, FAIL_COLOR, false, null),
      );
    }
  }

  private makeNode(
    poly: number[],
    centroid: { x: number; y: number },
    strokeColor: number,
    fillColor: number,
    bakeFill: boolean,
    type: BuildingType | null,
  ): Node {
    const localPoly = makeLocalPoly(poly, centroid);
    const fill = new Graphics();
    if (bakeFill) {
      fill.poly(localPoly).fill({ color: fillColor, alpha: 1 });
      if (type === 'factory') decorateFactory(fill, localPoly, fillColor);
    }
    fill.alpha = 0;

    const stroke = new Graphics();
    const cont = new Container();
    cont.position.set(centroid.x, centroid.y);
    cont.addChild(fill);
    cont.addChild(stroke);
    this.base.addChild(cont);

    const numEdges = poly.length / 2;
    return {
      cont,
      fill,
      stroke,
      localPoly,
      strokeColor,
      numEdges,
      perimeterDuration: numEdges * PERIMETER_EDGE_DURATION_S,
      done: false,
    };
  }

  private applyConfirmedAnimation(buildings: Building[], simTime: number): void {
    for (const b of buildings) {
      const node = this.buildingNodes.get(b.id);
      if (!node || node.done) continue;
      const ageSec = simTime - b.spawnedAt;
      const total = node.perimeterDuration + FILL_DURATION_S;

      if (ageSec >= total) {
        drawFullStroke(node.stroke, node.localPoly, node.strokeColor);
        node.fill.alpha = 1;
        node.done = true;
        continue;
      }
      if (ageSec < node.perimeterDuration) {
        drawPartialStroke(node.stroke, node.localPoly, ageSec / PERIMETER_EDGE_DURATION_S, node.strokeColor);
        node.fill.alpha = 0;
      } else {
        drawFullStroke(node.stroke, node.localPoly, node.strokeColor);
        const t = (ageSec - node.perimeterDuration) / FILL_DURATION_S;
        node.fill.alpha = t < 0 ? 0 : t > 1 ? 1 : t;
      }
    }
  }

  private applyFailedAnimation(failed: FailedAttempt[], simTime: number): void {
    // Failed attempts: same perimeter animation in red, no fill, then hold
    // until the store prunes them.
    for (const f of failed) {
      const node = this.failedNodes.get(f.id);
      if (!node) continue;
      const ageSec = simTime - f.spawnedAt;
      if (ageSec < node.perimeterDuration) {
        drawPartialStroke(node.stroke, node.localPoly, ageSec / PERIMETER_EDGE_DURATION_S, node.strokeColor);
      } else if (!node.done) {
        drawFullStroke(node.stroke, node.localPoly, node.strokeColor);
        node.done = true;
      }
      node.fill.alpha = 0;
    }
  }

  private drawHover(): void {
    const s = useWorldStore.getState();
    this.hover.clear();
    const bulldoze = s.bulldozeHover?.kind === 'building' ? s.bulldozeHover : null;
    const inspect = !bulldoze && s.hoverInfo?.kind === 'building' ? s.hoverInfo : null;
    const target = bulldoze ?? inspect;
    if (!target) return;
    const b = s.buildings.find((x) => x.id === target.id);
    if (!b) return;
    const color = bulldoze ? BULLDOZE : INSPECT;
    const alpha = bulldoze ? 0.5 : 0.35;
    this.hover.poly(b.poly).fill({ color, alpha });
  }

  private drawPreview(): void {
    const { buildings, bulldozePreview } = useWorldStore.getState();
    this.preview.clear();
    if (bulldozePreview.length === 0) return;
    const ids = new Set(bulldozePreview);
    for (const b of buildings) {
      if (!ids.has(b.id)) continue;
      this.preview.poly(b.poly).fill({ color: BULLDOZE, alpha: 0.4 });
    }
  }
}

function makeLocalPoly(poly: number[], centroid: { x: number; y: number }): number[] {
  const out = new Array(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    out[i] = poly[i] - centroid.x;
    out[i + 1] = poly[i + 1] - centroid.y;
  }
  return out;
}

function drawFullStroke(g: Graphics, localPoly: number[], color: number): void {
  g.clear();
  g.poly(localPoly).stroke({ width: STROKE_WIDTH, color, alpha: 1 });
}

function drawPartialStroke(
  g: Graphics,
  localPoly: number[],
  edgeProgress: number,
  color: number,
): void {
  g.clear();
  const n = localPoly.length / 2;
  if (n < 2) return;

  const completed = Math.min(n, Math.floor(edgeProgress));
  const partial = edgeProgress - completed;

  g.moveTo(localPoly[0], localPoly[1]);
  for (let i = 0; i < completed && i < n; i++) {
    const j = (i + 1) % n;
    g.lineTo(localPoly[2 * j], localPoly[2 * j + 1]);
  }
  if (completed < n && partial > 0) {
    const i = completed;
    const j = (i + 1) % n;
    const x0 = localPoly[2 * i];
    const y0 = localPoly[2 * i + 1];
    const x1 = localPoly[2 * j];
    const y1 = localPoly[2 * j + 1];
    g.lineTo(x0 + (x1 - x0) * partial, y0 + (y1 - y0) * partial);
  }
  g.stroke({ width: STROKE_WIDTH, color, alpha: 1 });

  const placedCount = Math.min(n, completed + 1);
  for (let i = 0; i < placedCount; i++) {
    g.circle(localPoly[2 * i], localPoly[2 * i + 1], DOT_RADIUS).fill({ color, alpha: 1 });
  }
}

function darken(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

// Industrial decoration: a darker inset rectangle inside the factory's local
// AABB (representing machinery / loading area) plus two small "stack" dots.
// The rectangle insets by 25% on each axis so it always sits inside the poly
// for any factory shape produced by the spawner.
function decorateFactory(g: Graphics, localPoly: number[], fillColor: number): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < localPoly.length; i += 2) {
    const x = localPoly[i];
    const y = localPoly[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const insetX = w * 0.25;
  const insetY = h * 0.25;
  const dark = darken(fillColor, 0.55);
  g.rect(minX + insetX, minY + insetY, w - 2 * insetX, h - 2 * insetY).fill({
    color: dark,
    alpha: 0.85,
  });
  const stackR = Math.min(w, h) * 0.06;
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const offset = Math.min(w, h) * 0.18;
  const stackColor = darken(fillColor, 0.3);
  g.circle(cx - offset, cy, stackR).fill({ color: stackColor });
  g.circle(cx + offset, cy, stackR).fill({ color: stackColor });
}
