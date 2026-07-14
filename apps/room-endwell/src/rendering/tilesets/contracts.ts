import type { AssetKey } from '../assets';

export const TILE_SLOT_NAMES = [
  'floorA', 'floorB', 'floorC', 'floorD', 'corridorHorizontal', 'corridorVertical',
  'wallNorth', 'wallSouth', 'wallWest', 'wallEast',
  'outerNorthWest', 'outerNorthEast', 'outerSouthEast', 'outerSouthWest',
  'innerNorthWest', 'innerNorthEast', 'innerSouthEast', 'innerSouthWest',
  'doorHorizontal', 'doorVertical', 'pillar', 'edgeDecoration', 'cornerDecoration', 'runeDecoration',
] as const;

export type DungeonTileSlot = typeof TILE_SLOT_NAMES[number];
export type DungeonTileSetManifest = {
  id: string; version: number; imageKey: AssetKey; tileSize: number; wallDepth: number; gutter: number; columns: number; rows: number;
  slots: Record<DungeonTileSlot, number>;
  floorVariants: Array<{ slot: DungeonTileSlot; weight: number }>;
  decorationDensity: number;
  colors: { void: string; shadow: string };
};

export function validateTileSetManifest(manifest: DungeonTileSetManifest, image?: { naturalWidth: number; naturalHeight: number }) {
  const errors: string[] = [];
  if (!Number.isInteger(manifest.tileSize) || manifest.tileSize < 32) errors.push('tileSize must be an integer >= 32');
  if (!Number.isInteger(manifest.wallDepth) || manifest.wallDepth < 8 || manifest.wallDepth > manifest.tileSize) errors.push('wallDepth must be between 8 and tileSize');
  if (!Number.isInteger(manifest.gutter) || manifest.gutter < 2) errors.push('gutter must be an integer >= 2');
  for (const name of TILE_SLOT_NAMES) if (!Number.isInteger(manifest.slots[name])) errors.push(`missing slot: ${name}`);
  const indices = Object.values(manifest.slots);
  if (new Set(indices).size !== indices.length) errors.push('slot indices must be unique');
  if (indices.some((index) => index < 0 || index >= manifest.columns * manifest.rows)) errors.push('slot index outside atlas');
  if (!manifest.floorVariants.length || manifest.floorVariants.some((entry) => entry.weight <= 0 || !/^floor[A-D]$/.test(entry.slot))) errors.push('invalid floor variants');
  if (manifest.decorationDensity < 0 || manifest.decorationDensity > 1) errors.push('decorationDensity must be between 0 and 1');
  const span = manifest.tileSize + manifest.gutter * 2;
  if (image && (image.naturalWidth !== manifest.columns * span || image.naturalHeight !== manifest.rows * span)) errors.push('atlas dimensions do not match manifest');
  return errors;
}
