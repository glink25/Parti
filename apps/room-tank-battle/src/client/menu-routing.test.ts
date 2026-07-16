import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('lobby action routing', () => {
  it('routes gameplay actions through PartiFlow instead of the raw Parti protocol', () => {
    const source = readFileSync(new URL('./menu.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('parti.action(');
    expect(source).toContain('dispatch(');
  });

  it('uses a custom popup menu instead of native selects', () => {
    const source = readFileSync(new URL('./menu.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('<select');
    expect(source).toContain('data-option=');
  });

  it('releases LittleJS input capture while lobby controls are visible', () => {
    const source = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    expect(source).toContain("setInputPreventDefault(next.phase === 'running')");
  });

  it('does not replace lobby controls for an unchanged authority snapshot', () => {
    const source = readFileSync(new URL('./menu.ts', import.meta.url), 'utf8');
    expect(source).toContain('if (renderKey === lastRenderKey) return');
  });
});
