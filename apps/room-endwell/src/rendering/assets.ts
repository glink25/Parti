export type AssetKey = 'atlas' | 'world' | 'ui' | 'vfx' | 'tiles';

export type TileSprite = { cell: number; drawWidth: number; drawHeight: number; anchorY?: number };

export const TILE_SPRITES = {
  player: { cell: 0, drawWidth: 74, drawHeight: 74, anchorY: 3 },
  ally: { cell: 1, drawWidth: 72, drawHeight: 72, anchorY: 3 },
  chaser: { cell: 2, drawWidth: 70, drawHeight: 62, anchorY: 5 },
  shooter: { cell: 3, drawWidth: 66, drawHeight: 72, anchorY: 2 },
  guardian: { cell: 4, drawWidth: 78, drawHeight: 78, anchorY: 6 },
  boss: { cell: 5, drawWidth: 142, drawHeight: 142, anchorY: 12 },
  merchant: { cell: 6, drawWidth: 76, drawHeight: 82, anchorY: 2 },
  forge: { cell: 7, drawWidth: 88, drawHeight: 88 },
  obstacle: { cell: 8, drawWidth: 82, drawHeight: 82 },
  portal: { cell: 9, drawWidth: 94, drawHeight: 94 },
  rune: { cell: 10, drawWidth: 72, drawHeight: 72 },
  loot: { cell: 11, drawWidth: 42, drawHeight: 42 },
  lootStaff: { cell: 12, drawWidth: 46, drawHeight: 46 },
  lootRobe: { cell: 13, drawWidth: 44, drawHeight: 44 },
  lootRing: { cell: 14, drawWidth: 40, drawHeight: 40 },
  lootScroll: { cell: 15, drawWidth: 42, drawHeight: 42 },
  lootCatalyst: { cell: 10, drawWidth: 38, drawHeight: 38 },
} satisfies Record<string, TileSprite>;

const paths: Record<AssetKey, string[]> = {
  atlas: ['/assets/endwell/atlas/endwell-sprites.webp'],
  world: ['/assets/endwell/atlas/endwell-world.webp'],
  ui: ['/assets/endwell/atlas/endwell-ui.webp'],
  vfx: ['/assets/endwell/atlas/endwell-vfx.webp'],
  tiles: ['/assets/endwell/atlas/endwell-ruins-tiles.webp?v=1'],
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
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = src;
  });
}

export function atlasSource(image: HTMLImageElement, cell: number) {
  const w = image.naturalWidth / 4, h = image.naturalHeight / 4;
  return { x: cell % 4 * w, y: Math.floor(cell / 4) * h, w, h };
}
