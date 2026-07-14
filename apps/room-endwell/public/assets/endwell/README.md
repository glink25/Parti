# Endwell final art manifest

Art direction: **Neon Arcana × Obsidian Ruins** — painterly dark-fantasy silhouettes over a restrained indigo world, with bright elemental cores reserved for spells and combat feedback.

## Production bitmap atlases

`atlas/endwell-sprites.webp` is a transparent 4×4 production atlas containing, in row-major order:

1. player mage, allied mage, ruins chaser, ruins shooter
2. ruins guardian, boss guardian, wandering merchant, arcane forge
3. obsidian obstacle, portal, floor rune/catalyst, loot bag
4. staff, robe, ring, spell scroll

Additional compressed atlases provide the world, UI and combat layers:

- `atlas/endwell-ruins-tiles.webp`: replaceable 8×3 semantic dungeon TileSet
- `atlas/endwell-ui.webp`: elemental medallions, panels, bars, slots and minimap frame
- `atlas/endwell-vfx.webp`: projectiles, impacts, fields, explosions and death ruptures
- `atlas/endwell-world.webp`: source artwork retained for standalone world props

## Replaceable dungeon themes

The ruins map is generated from the fixed `DungeonTileSetManifest` contract. Its 24 row-major slots contain four seamless floor variants, horizontal/vertical corridor floors, four wall directions, outer and inner corners, two doorway directions, pillars, edge/corner ornaments and a large rune overlay.

Each 128px tile has a 2px extruded gutter. Floor selection is deterministic from stage seed and world coordinates; decorations never enter the ordinary floor pool. A future ice cave, volcano or swamp theme can replace the atlas and manifest values without changing room generation or rendering code.

Run `scripts/build-endwell-tiles.mjs` with Sharp available to rebuild the compressed ruins TileSet from the authored source material.

## Procedural visual assets

Canvas rendering supplies the remaining visible art without extra downloads:

- seven distinct elemental HUD sigils and arcane panel ornament
- targeting guides, minimap and status treatments
- projectiles, beams, lightning forks, spray cones, fields, shields and weather
- hit flashes, radial shock rings, elemental shards, death rupture, soul motes and camera shake
- health bars, combat numbers, cast telegraphs and interaction highlights

This hybrid approach keeps effects resolution-independent and leaves the complete production art directory far below the 5MB limit.
