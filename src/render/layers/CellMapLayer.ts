import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import { useUiStore } from '@game/store/uiStore';
import { useWorldStore } from '@game/store/worldStore';
import type { DemandMap } from '@game/demand/maps';

// Single sprite covering the world bounds, textured by the active demand map's
// cell data through its palette. Linear-filtered so blob edges look smooth.
export class CellMapLayer {
  readonly container = new Container();
  private sprite: Sprite | null = null;
  private source: BufferImageSource | null = null;
  private texture: Texture | null = null;
  private rgba: Uint8Array | null = null;
  private currentMapId: string | null = null;
  private builtForVersion = -1;

  constructor() {
    this.container.label = 'cell-map';
  }

  update(): void {
    const activeId = useUiStore.getState().activeDemandMap;
    const { demandMaps, demandMapsVersion } = useWorldStore.getState();

    if (!activeId) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    const map = demandMaps.find((m) => m.id === activeId);
    if (!map) return;

    if (this.currentMapId !== activeId) {
      this.currentMapId = activeId;
      this.builtForVersion = -1;
      this.bindMap(map);
    }
    if (this.builtForVersion !== demandMapsVersion) {
      this.builtForVersion = demandMapsVersion;
      this.uploadTexture(map);
    }
  }

  private bindMap(map: DemandMap): void {
    if (this.sprite) this.container.removeChild(this.sprite);
    if (this.texture) this.texture.destroy(true);

    const { cellMap } = map;
    const rgba = new Uint8Array(cellMap.cols * cellMap.rows * 4);
    const source = new BufferImageSource({
      resource: rgba,
      width: cellMap.cols,
      height: cellMap.rows,
      scaleMode: 'linear',
    });
    const texture = new Texture({ source });
    const sprite = new Sprite(texture);
    sprite.x = cellMap.originX;
    sprite.y = cellMap.originY;
    sprite.width = cellMap.cols * cellMap.cellSize;
    sprite.height = cellMap.rows * cellMap.cellSize;

    this.rgba = rgba;
    this.source = source;
    this.texture = texture;
    this.sprite = sprite;
    this.container.addChild(sprite);
  }

  private uploadTexture(map: DemandMap): void {
    if (!this.rgba || !this.source) return;
    const { data } = map.cellMap;
    const rgba = this.rgba;
    for (let p = 0; p < data.length; p++) {
      map.palette(data[p], rgba, p * 4);
    }
    this.source.update();
  }
}
