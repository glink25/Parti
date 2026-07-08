export type AssetKey = 'dungeon' | 'explosion' | 'flash' | 'whitePuff' | 'blackSmoke';

export type TileSprite = { tile: number; drawWidth: number; drawHeight: number; anchorY?: number };

export const TILE_SPRITES = {
  player: { tile: 84, drawWidth: 52, drawHeight: 52, anchorY: 8 },
  ally: { tile: 85, drawWidth: 52, drawHeight: 52, anchorY: 8 },
  chaser: { tile: 109, drawWidth: 52, drawHeight: 52, anchorY: 7 },
  shooter: { tile: 111, drawWidth: 50, drawHeight: 50, anchorY: 7 },
  guardian: { tile: 97, drawWidth: 64, drawHeight: 64, anchorY: 9 },
  boss: { tile: 97, drawWidth: 112, drawHeight: 112, anchorY: 15 },
  merchant: { tile: 88, drawWidth: 52, drawHeight: 52, anchorY: 8 },
  forge: { tile: 35, drawWidth: 70, drawHeight: 70 },
  loot: { tile: 125, drawWidth: 36, drawHeight: 36 },
  lootStaff: { tile: 125, drawWidth: 36, drawHeight: 36 },
  lootRobe: { tile: 100, drawWidth: 36, drawHeight: 36 },
  lootRing: { tile: 102, drawWidth: 32, drawHeight: 32 },
  lootScroll: { tile: 101, drawWidth: 34, drawHeight: 34 },
  lootCatalyst: { tile: 114, drawWidth: 34, drawHeight: 34 },
  obstacle: { tile: 69, drawWidth: 64, drawHeight: 64 },
  rune: { tile: 47, drawWidth: 64, drawHeight: 64 },
  portal: { tile: 59, drawWidth: 86, drawHeight: 86 },
} satisfies Record<string, TileSprite>;

const paths: Record<AssetKey, string[]> = {
  dungeon: ['/assets/endwell/world/tiny-dungeon.png'],
  explosion: Array.from({ length: 9 }, (_, i) => `/assets/endwell/effects/explosion/explosion${String(i).padStart(2, '0')}.png`),
  flash: Array.from({ length: 9 }, (_, i) => `/assets/endwell/effects/flash/flash${String(i).padStart(2, '0')}.png`),
  whitePuff: Array.from({ length: 25 }, (_, i) => `/assets/endwell/effects/white-puff/whitePuff${String(i).padStart(2, '0')}.png`),
  blackSmoke: Array.from({ length: 25 }, (_, i) => `/assets/endwell/effects/black-smoke/blackSmoke${String(i).padStart(2, '0')}.png`),
};

export class EndwellAssets {
  private images = new Map<AssetKey, HTMLImageElement[]>();
  loaded = false;

  async load() {
    const entries = await Promise.all(Object.entries(paths).map(async ([key, urls]) => {
      const images = (await Promise.all(urls.map(loadImage))).filter((image): image is HTMLImageElement => Boolean(image));
      return [key as AssetKey, images] as const;
    }));
    this.images = new Map(entries);
    this.loaded = true;
  }

  image(key: AssetKey, index = 0) { const list = this.images.get(key) ?? []; return list[index % Math.max(1, list.length)]; }
  frame(key: AssetKey, elapsedMs: number, frameMs = 70) { const list = this.images.get(key) ?? []; return list[Math.floor(Math.max(0, elapsedMs) / frameMs) % Math.max(1, list.length)]; }
  frameCount(key: AssetKey) { return this.images.get(key)?.length ?? 0; }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export function tileSource(tile: number) { return { x: tile % 12 * 16, y: Math.floor(tile / 12) * 16, w: 16, h: 16 }; }
