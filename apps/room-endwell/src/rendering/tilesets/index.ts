import type { ThemeId } from '../../game/contracts';
import type { DungeonTileSetManifest } from './contracts';
import { RUINS_TILESET } from './ruins';

const TILESETS: Record<ThemeId, DungeonTileSetManifest> = { ruins: RUINS_TILESET };
export function tileSetFor(themeId: ThemeId) { return TILESETS[themeId] ?? RUINS_TILESET; }
export { RUINS_TILESET };
