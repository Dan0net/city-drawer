import { Container, Graphics } from 'pixi.js';
import type { Building, BuildingId, FailedAttempt, FailedAttemptId } from '@game/buildings';
import { BUILDING_COLORS } from '@game/buildings';
import { useWorldStore } from '@game/store/worldStore';

const STROKE_WIDTH = 1.2;
const DOT_RADIUS = 0.9;
const BULLDOZE = 0xe55050;
const FAIL_COLOR = 0xe55050;

const EDGE_DURATION = 0.2;
const FILL_DURATION = 0.4;

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
  private hover = new Graphics();
  private buildingNodes = new Map<BuildingId, Node>();
  private failedNodes = new Map<FailedAttemptId, Node>();
  private lastBuildingsVersion = -1;
  private lastFailedVersion = -1;
  private lastHover: number | null = null;

  constructor() {
    this.container.label = 'buildings';
    this.container.addChild(this.base);
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

    const hoverId = s.bulldozeHover?.kind === 'building' ? s.bulldozeHover.id : null;
    if (hoverId !== this.lastHover) {
      this.lastHover = hoverId;
      this.drawHover();
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
        this.makeNode(b.poly, b.centroid, strokeColor, fillColor, true),
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
        this.makeNode(f.poly, f.centroid, FAIL_COLOR, FAIL_COLOR, false),
      );
    }
  }

  private makeNode(
    poly: number[],
    centroid: { x: number; y: number },
    strokeColor: number,
    fillColor: number,
    bakeFill: boolean,
  ): Node {
    const localPoly = makeLocalPoly(poly, centroid);
    const fill = new Graphics();
    if (bakeFill) {
      fill.poly(localPoly).fill({ color: fillColor, alpha: 1 });
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
      perimeterDuration: numEdges * EDGE_DURATION,
      done: false,
    };
  }

  private applyConfirmedAnimation(buildings: Building[], simTime: number): void {
    for (const b of buildings) {
      const node = this.buildingNodes.get(b.id);
      if (!node || node.done) continue;
      const ageSec = simTime - b.spawnedAt;
      const total = node.perimeterDuration + FILL_DURATION;

      if (ageSec >= total) {
        drawFullStroke(node.stroke, node.localPoly, node.strokeColor);
        node.fill.alpha = 1;
        node.done = true;
        continue;
      }
      if (ageSec < node.perimeterDuration) {
        drawPartialStroke(node.stroke, node.localPoly, ageSec / EDGE_DURATION, node.strokeColor);
        node.fill.alpha = 0;
      } else {
        drawFullStroke(node.stroke, node.localPoly, node.strokeColor);
        const t = (ageSec - node.perimeterDuration) / FILL_DURATION;
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
        drawPartialStroke(node.stroke, node.localPoly, ageSec / EDGE_DURATION, node.strokeColor);
      } else if (!node.done) {
        drawFullStroke(node.stroke, node.localPoly, node.strokeColor);
        node.done = true;
      }
      node.fill.alpha = 0;
    }
  }

  private drawHover(): void {
    const { buildings, bulldozeHover } = useWorldStore.getState();
    this.hover.clear();
    if (bulldozeHover?.kind !== 'building') return;
    const b = buildings.find((x) => x.id === bulldozeHover.id);
    if (!b) return;
    this.hover.poly(b.poly).fill({ color: BULLDOZE, alpha: 0.5 });
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
