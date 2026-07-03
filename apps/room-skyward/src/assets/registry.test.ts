import { describe, expect, it } from 'vitest';
import { animationFrame, characterSkinForIndex, projectileVariant, projectileVisuals, themeForBiome } from './catalog';
import { AssetRegistry, Registry, SoundPlayer } from './registry';

describe('skyward asset registry', () => {
  it('rejects duplicate ids', () => {
    const registry = new AssetRegistry();
    registry.registerImage({ id: 'image', src: '/image.png' });
    expect(() => registry.registerImage({ id: 'image', src: '/other.png' })).toThrow(/Duplicate/);
  });

  it('validates registered values', () => {
    const registry = new Registry<{ id: string; ready: boolean }>('fixture', (value) => { if (!value.ready) throw new Error('not ready'); });
    expect(() => registry.register({ id: 'bad', ready: false })).toThrow('not ready');
  });

  it('falls back to dawn for an unknown biome', () => expect(themeForBiome('missing').id).toBe('dawn'));
  it('cycles character skins for larger parties', () => expect(characterSkinForIndex(4).id).toBe(characterSkinForIndex(0).id));
  it('selects deterministic animation frames', () => {
    expect(animationFrame(['a', 'b'], 0)).toBe('a');
    expect(animationFrame(['a', 'b'], 220)).toBe('b');
  });

  it('tracks the sound enabled state', () => {
    const player = new SoundPlayer(new AssetRegistry());
    expect(player.isEnabled()).toBe(true);
    player.setEnabled(false);
    expect(player.isEnabled()).toBe(false);
  });

  it('selects registered projectile visuals with power precedence', () => {
    expect(projectileVariant(false, 0)).toBe('normal');
    expect(projectileVariant(false, 1)).toBe('spread');
    expect(projectileVariant(true, 0)).toBe('power');
    expect(projectileVariant(true, 2)).toBe('power');
    expect(projectileVisuals.all().map((visual) => visual.id).sort()).toEqual(['normal', 'power', 'spread']);
    expect(projectileVisuals.all().every((visual) => visual.size > 0 && visual.size <= 22)).toBe(true);
  });
});
