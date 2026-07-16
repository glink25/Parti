import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('LittleJS render order', () => {
  it('draws dynamic actors after automatic TileLayer rendering', () => {
    const source = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    const prepare = source.indexOf('() => prepareWorld(state)');
    const actors = source.indexOf('renderActors(state, parti.playerId, predicted)');
    const hud = source.indexOf('renderHud(state, parti.playerId)');
    expect(prepare).toBeGreaterThan(-1);
    expect(actors).toBeGreaterThan(prepare);
    expect(hud).toBeGreaterThan(actors);
  });

  it('renders tanks and bullets with engine primitives instead of fragile atlas slices', () => {
    const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    expect(source).toContain('function drawPixelTank(');
    expect(source).toContain('function drawBullet(');
    expect(source).not.toContain('drawTile(pos');
  });

  it('forces dynamic primitives onto the Canvas foreground instead of WebGL behind TileLayer', () => {
    const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    expect(source).toContain('function drawActorRect(');
    expect(source).toContain('drawRect(pos, size, color, angle, false)');
    expect(source).toContain('function drawActorLine(');
  });

  it('uses a dedicated pointer-event touch controller', () => {
    const source = readFileSync(new URL('./touch-controls.ts', import.meta.url), 'utf8');
    expect(source).toContain("addEventListener('pointerdown'");
    expect(source).toContain("addEventListener('pointermove'");
    expect(source).toContain('readTouchControls');
  });
});
