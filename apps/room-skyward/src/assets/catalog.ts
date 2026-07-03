import { AssetRegistry, Registry, type AssetId } from './registry';

export type BiomeTheme = {
  id: string;
  background: AssetId;
  terrain: { left: AssetId; middle: AssetId; right: AssetId };
  relay: AssetId;
  gate: AssetId;
  palette: { sky: string; haze: string; panel: string; accent: string };
};
export type CharacterSkin = {
  id: string;
  idle: AssetId;
  walk: [AssetId, AssetId];
  jump: AssetId;
  hit: AssetId;
  avatar: AssetId;
  scale: number;
};
export type EnemySkin = { id: string; idle: AssetId; move: [AssetId, AssetId]; hit?: AssetId; scale: number; bottomInset: number; offsetY?: number };
export type PickupVisual = { icon: AssetId; size: number; bottomInset: number; hover: number };
export type ProjectileVariant = 'normal' | 'spread' | 'power';
export type ProjectileVisual = { id: ProjectileVariant; image: AssetId; size: number; glow: string };
export type UiTheme = {
  id: string;
  colors: { panel: string; panelBorder: string; button: string; buttonPressed: string; text: string; muted: string; danger: string };
  icons: Record<'height' | 'boss' | 'fire' | 'shield' | 'rapid' | 'spread' | 'power', AssetId>;
  sounds: Record<'select' | 'jump' | 'hurt' | 'shoot' | 'pickup' | 'vanish', AssetId>;
};

export const assets = new AssetRegistry();
export const biomeThemes = new Registry<BiomeTheme>('biome theme', validateBiome);
export const characterSkins = new Registry<CharacterSkin>('character skin', validateCharacter);
export const enemySkins = new Registry<EnemySkin>('enemy skin', validateEnemy);
export const uiThemes = new Registry<UiTheme>('UI theme', validateUi);
export const projectileVisuals = new Registry<ProjectileVisual>('projectile visual', validateProjectile);

export const registerBiomeTheme = (theme: BiomeTheme) => biomeThemes.register(theme);
export const registerCharacterSkin = (skin: CharacterSkin) => characterSkins.register(skin);
export const registerEnemySkin = (skin: EnemySkin) => enemySkins.register(skin);
export const registerUiTheme = (theme: UiTheme) => uiThemes.register(theme);
export const registerProjectileVisual = (visual: ProjectileVisual) => projectileVisuals.register(visual);

const image = (id: string, folder: string, file: string) => assets.registerImage({ id, src: `/assets/skyward/${folder}/${file}` });
const audio = (id: string, file: string) => assets.registerAudio({ id, src: `/assets/skyward/audio/${file}` });

const backgrounds = ['hills', 'trees', 'mushrooms'] as const;
backgrounds.forEach((name) => image(`background.${name}`, 'backgrounds', `${name}.png`));
(['grass', 'dirt', 'purple'] as const).forEach((name) => {
  image(`terrain.${name}.left`, 'terrain', `${name}-left.png`);
  image(`terrain.${name}.middle`, 'terrain', `${name}-middle.png`);
  image(`terrain.${name}.right`, 'terrain', `${name}-right.png`);
});
image('terrain.relay', 'terrain', 'relay.png'); image('terrain.gate', 'terrain', 'gate.png');

(['green', 'yellow', 'pink', 'purple'] as const).forEach((color) => {
  for (const state of ['idle', 'walk-a', 'walk-b', 'jump', 'hit', 'avatar']) image(`character.${color}.${state}`, 'characters', `${color}-${state}.png`);
});
for (const name of ['normal-idle', 'normal-a', 'normal-b', 'spike-idle', 'spike-a', 'spike-b', 'boss-idle', 'boss-a', 'boss-b']) image(`enemy.${name}`, 'enemies', `${name}.png`);
for (const name of ['height', 'boss', 'fire', 'shield', 'rapid', 'spread', 'power']) image(`icon.${name}`, 'items', `${name}.png`);
for (const name of ['normal', 'spread', 'power']) image(`projectile.${name}`, 'projectiles', `${name}.png`);
for (const name of ['select', 'jump', 'hurt', 'shoot', 'pickup', 'vanish']) audio(`sound.${name}`, `${name}.ogg`);

registerBiomeTheme({ id: 'dawn', background: 'background.hills', terrain: { left: 'terrain.grass.left', middle: 'terrain.grass.middle', right: 'terrain.grass.right' }, relay: 'terrain.relay', gate: 'terrain.gate', palette: { sky: '#3498cf', haze: '#b9e8f4', panel: '#173b59dd', accent: '#ffd166' } });
registerBiomeTheme({ id: 'garden', background: 'background.trees', terrain: { left: 'terrain.dirt.left', middle: 'terrain.dirt.middle', right: 'terrain.dirt.right' }, relay: 'terrain.relay', gate: 'terrain.gate', palette: { sky: '#269a83', haze: '#b8efd2', panel: '#174d43dd', accent: '#8ee58b' } });
registerBiomeTheme({ id: 'storm', background: 'background.mushrooms', terrain: { left: 'terrain.purple.left', middle: 'terrain.purple.middle', right: 'terrain.purple.right' }, relay: 'terrain.relay', gate: 'terrain.gate', palette: { sky: '#362d72', haze: '#a99be8', panel: '#29234fdd', accent: '#c6b8ff' } });

export const CHARACTER_SKIN_IDS = ['green', 'yellow', 'pink', 'purple'] as const;
CHARACTER_SKIN_IDS.forEach((color) => registerCharacterSkin({ id: color, idle: `character.${color}.idle`, walk: [`character.${color}.walk-a`, `character.${color}.walk-b`], jump: `character.${color}.jump`, hit: `character.${color}.hit`, avatar: `character.${color}.avatar`, scale: 1.08 }));
registerEnemySkin({ id: 'drifter', idle: 'enemy.normal-idle', move: ['enemy.normal-a', 'enemy.normal-b'], scale: 1.05, bottomInset: .15 });
registerEnemySkin({ id: 'spike', idle: 'enemy.spike-idle', move: ['enemy.spike-a', 'enemy.spike-b'], scale: 1.05, bottomInset: .15 });
registerEnemySkin({ id: 'boss', idle: 'enemy.boss-idle', move: ['enemy.boss-a', 'enemy.boss-b'], scale: 3.2, bottomInset: .15, offsetY: -8 });
registerUiTheme({ id: 'default', colors: { panel: '#132943e8', panelBorder: '#8bd5e8', button: '#ffd166', buttonPressed: '#e9ad43', text: '#fff9dc', muted: '#cbe4ee', danger: '#ff6685' }, icons: { height: 'icon.height', boss: 'icon.boss', fire: 'icon.fire', shield: 'icon.shield', rapid: 'icon.rapid', spread: 'icon.spread', power: 'icon.power' }, sounds: { select: 'sound.select', jump: 'sound.jump', hurt: 'sound.hurt', shoot: 'sound.shoot', pickup: 'sound.pickup', vanish: 'sound.vanish' } });
registerProjectileVisual({ id: 'normal', image: 'projectile.normal', size: 18, glow: '#fff7a8' });
registerProjectileVisual({ id: 'spread', image: 'projectile.spread', size: 14, glow: '#72d9ff' });
registerProjectileVisual({ id: 'power', image: 'projectile.power', size: 22, glow: '#ff8b54' });

export const PICKUP_VISUALS: Record<'rapid' | 'spread' | 'power' | 'team-shield', PickupVisual> = {
  rapid: { icon: 'icon.rapid', size: 62, bottomInset: .1, hover: 8 },
  spread: { icon: 'icon.spread', size: 62, bottomInset: .1, hover: 8 },
  power: { icon: 'icon.power', size: 62, bottomInset: .1, hover: 8 },
  'team-shield': { icon: 'icon.shield', size: 62, bottomInset: .08, hover: 8 },
};

function assertImages(ids: string[], label: string) { for (const id of ids) if (!assets.hasImage(id)) throw new Error(`${label} references unknown image: ${id}`); }
function validateBiome(value: BiomeTheme) { assertImages([value.background, value.terrain.left, value.terrain.middle, value.terrain.right, value.relay, value.gate], `Biome ${value.id}`); }
function validateCharacter(value: CharacterSkin) { assertImages([value.idle, ...value.walk, value.jump, value.hit, value.avatar], `Character ${value.id}`); }
function validateEnemy(value: EnemySkin) {
  assertImages([value.idle, ...value.move, ...(value.hit ? [value.hit] : [])], `Enemy ${value.id}`);
  if (value.bottomInset < 0 || value.bottomInset >= 1) throw new Error(`Enemy ${value.id} has invalid bottomInset`);
}
function validateUi(value: UiTheme) { assertImages(Object.values(value.icons), `UI ${value.id}`); for (const id of Object.values(value.sounds)) if (!assets.hasAudio(id)) throw new Error(`UI ${value.id} references unknown audio: ${id}`); }
function validateProjectile(value: ProjectileVisual) {
  assertImages([value.image], `Projectile ${value.id}`);
  if (!(value.size > 0 && value.size <= 32)) throw new Error(`Projectile ${value.id} has invalid size`);
}

export const defaultBiomeTheme = () => biomeThemes.require('dawn');
export const themeForBiome = (id: string) => biomeThemes.get(id) ?? defaultBiomeTheme();
export const characterSkinForIndex = (index: number) => characterSkins.require(CHARACTER_SKIN_IDS[((index % CHARACTER_SKIN_IDS.length) + CHARACTER_SKIN_IDS.length) % CHARACTER_SKIN_IDS.length]);
export const animationFrame = <T>(frames: readonly [T, T], time: number, frameMs = 220) => frames[Math.floor(time / frameMs) % frames.length];
export const projectileVariant = (power: boolean, projectileIndex: number): ProjectileVariant => power ? 'power' : projectileIndex > 0 ? 'spread' : 'normal';
