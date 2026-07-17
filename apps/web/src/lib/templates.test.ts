import { describe, expect, it } from 'vitest';
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
