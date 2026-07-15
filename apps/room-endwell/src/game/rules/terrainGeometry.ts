import type { TerrainState, Vec2 } from '../contracts';

export type TerrainBounds = { shape: 'circle'; radius: number } | { shape: 'rect'; width: number; height: number };
export function terrainBounds(terrain: TerrainState): TerrainBounds { return terrain.width != null && terrain.height != null ? { shape: 'rect', width: terrain.width, height: terrain.height } : { shape: 'circle', radius: terrain.radius }; }
export function terrainOverlaps(terrain: TerrainState, point: Vec2, radius: number) { const bounds = terrainBounds(terrain); return bounds.shape === 'rect' ? Math.abs(point.x - terrain.position.x) <= bounds.width / 2 + radius && Math.abs(point.y - terrain.position.y) <= bounds.height / 2 + radius : Math.hypot(point.x - terrain.position.x, point.y - terrain.position.y) <= bounds.radius + radius; }
