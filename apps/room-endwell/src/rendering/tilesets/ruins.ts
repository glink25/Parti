import { TILE_SLOT_NAMES, type DungeonTileSetManifest, type DungeonTileSlot } from './contracts';
export { validateTileSetManifest } from './contracts';

export const RUINS_TILESET: DungeonTileSetManifest = {
  id: 'ruins', version: 2, imageKey: 'tiles', tileSize: 128, wallDepth: 64, gutter: 2, columns: 8, rows: 3,
  slots: Object.fromEntries(TILE_SLOT_NAMES.map((name, index) => [name, index])) as Record<DungeonTileSlot, number>,
  floorVariants: [
    { slot: 'floorA', weight: 70 }, { slot: 'floorB', weight: 18 },
    { slot: 'floorC', weight: 9 }, { slot: 'floorD', weight: 3 },
  ],
  decorationDensity: .38,
  colors: { void: '#070711', shadow: '#020208' },
};
