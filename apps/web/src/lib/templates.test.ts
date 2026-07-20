import { describe, expect, it } from 'vitest';
import { resolveImportedCover } from './templates';
import { isImportedTemplateSource } from './templateSources';

describe('template source categories', () => {
  it('treats external imports and blank editor creations as imported', () => {
    expect(isImportedTemplateSource({ type: 'zip' })).toBe(true);
    expect(isImportedTemplateSource({ type: 'github' })).toBe(true);
    expect(isImportedTemplateSource({ type: 'editor' })).toBe(true);
  });

  it('does not treat derived editor, builtin, or custom references as imported', () => {
    expect(isImportedTemplateSource({ type: 'editor', basedOn: 'counter' })).toBe(false);
    expect(isImportedTemplateSource({ type: 'builtin', id: 'counter' })).toBe(false);
    expect(isImportedTemplateSource({ type: 'custom', id: 'imported-room' })).toBe(false);
  });
});

describe('imported template covers', () => {
  const bytes = new TextEncoder().encode('<svg></svg>');

  it('converts nested package-relative images to data URLs', () => {
    expect(resolveImportedCover('./assets/cover.svg', { 'assets/cover.svg': bytes }))
      .toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
  });

  it('keeps absolute URLs unchanged', () => {
    expect(resolveImportedCover('https://cdn.example.com/cover.png', {}))
      .toBe('https://cdn.example.com/cover.png');
    expect(resolveImportedCover('/covers/game.png', {})).toBe('/covers/game.png');
  });

  it('falls back when the file is absent or not an image', () => {
    expect(resolveImportedCover('missing.png', {})).toBeUndefined();
    expect(resolveImportedCover('cover.txt', { 'cover.txt': bytes })).toBeUndefined();
  });
});
