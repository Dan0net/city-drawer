import {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Texture,
} from 'pixi.js';
import type { Building, BuildingId, BuildingType } from '@game/buildings';
import { BUILDING_COLORS, obbCorners } from '@game/buildings';
import { useWorldStore } from '@game/store/worldStore';
import { bakeBuildingTextures, TEXTURE_SIZE } from '@render/buildings/textures';

const GHOST_TINT = 0xb0b4bb;
const BULLDOZE = 0xe55050;

interface Node {
  particle: Particle;
}

// Single batched container for every building. Each building is one Particle:
// position/scale/rotation baked at insert, tint+alpha mutated per frame to
// reflect progress. Stress test: tens of thousands of buildings render in one
// draw call because everything shares the same shader pipeline.
export class BuildingsLayer {
  readonly container = new Container();
  private particles: ParticleContainer;
  private hover = new Graphics();
  private nodes = new Map<BuildingId, Node>();
  private textures: Record<BuildingType, Texture>;
  private lastVersion = -1;
  private lastHover: number | null = null;

  constructor(app: Application) {
    this.container.label = 'buildings';
    this.textures = bakeBuildingTextures(app);
    this.particles = new ParticleContainer({
      dynamicProperties: {
        position: false,
        scale: false,
        rotation: false,
        uvs: false,
        color: true,
      },
    });
    this.container.addChild(this.particles);
    this.container.addChild(this.hover);
  }

  update(): void {
    const s = useWorldStore.getState();
    if (s.buildingsVersion !== this.lastVersion) {
      this.lastVersion = s.buildingsVersion;
      this.syncParticles(s.buildings);
    }
    this.applyProgress(s.buildings);

    const hoverId = s.bulldozeHover?.kind === 'building' ? s.bulldozeHover.id : null;
    if (hoverId !== this.lastHover) {
      this.lastHover = hoverId;
      this.drawHover();
    }
  }

  private syncParticles(buildings: Building[]): void {
    const live = new Set<BuildingId>();
    for (const b of buildings) live.add(b.id);

    for (const [id, node] of this.nodes) {
      if (live.has(id)) continue;
      this.particles.removeParticle(node.particle);
      this.nodes.delete(id);
    }

    for (const b of buildings) {
      if (this.nodes.has(b.id)) continue;
      const tex = this.textures[b.type];
      const p = new Particle({
        texture: tex,
        x: b.cx,
        y: b.cy,
        scaleX: b.w / TEXTURE_SIZE,
        scaleY: b.h / TEXTURE_SIZE,
        rotation: b.rot,
        anchorX: 0.5,
        anchorY: 0.5,
        tint: GHOST_TINT,
        alpha: 0.3,
      });
      this.particles.addParticle(p);
      this.nodes.set(b.id, { particle: p });
    }
  }

  private applyProgress(buildings: Building[]): void {
    for (const b of buildings) {
      const node = this.nodes.get(b.id);
      if (!node) continue;
      const p = b.progress;
      node.particle.tint = lerpColor(GHOST_TINT, BUILDING_COLORS[b.type], p);
      node.particle.alpha = 0.3 + 0.7 * p;
    }
  }

  private drawHover(): void {
    const { buildings, bulldozeHover } = useWorldStore.getState();
    this.hover.clear();
    if (bulldozeHover?.kind !== 'building') return;
    const b = buildings.find((x) => x.id === bulldozeHover.id);
    if (!b) return;
    this.hover.poly(obbCorners(b)).fill({ color: BULLDOZE, alpha: 0.5 });
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = (ar + (br - ar) * t) | 0;
  const g = (ag + (bg - ag) * t) | 0;
  const bl = (ab + (bb - ab) * t) | 0;
  return (r << 16) | (g << 8) | bl;
}
