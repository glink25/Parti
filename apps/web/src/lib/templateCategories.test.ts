import { describe, expect, it } from 'vitest';
import type { TemplateListEntry } from './rooms';
import { buildTemplateCategories, normalizeTemplateCategory, templatesInCategory } from './templateCategories';

function entry(id: string, removable: boolean, tags: string[] = [], imported = removable): TemplateListEntry {
  return { id, name: id, description: '', removable, imported, usageCount: 0, tags };
}

const templates = [
  entry('chat', false),
  entry('counter', false),
  entry('builtin-party', false, ['party', 'turn-based']),
  entry('imported-party', true, ['party', 'custom-tag']),
  entry('editor-draft', true, ['custom-tag'], false),
];

describe('template categories', () => {
  it('applies fixed category membership', () => {
    expect(templatesInCategory(templates, 'all')).toHaveLength(5);
    expect(templatesInCategory(templates, 'imported').map(({ id }) => id)).toEqual(['imported-party']);
    expect(templatesInCategory(templates, 'simple').map(({ id }) => id)).toEqual(['chat', 'counter']);
  });

  it('cross-lists multi-tag and imported templates', () => {
    expect(templatesInCategory(templates, 'tag:party').map(({ id }) => id))
      .toEqual(['builtin-party', 'imported-party']);
    expect(templatesInCategory(templates, 'tag:turn-based').map(({ id }) => id))
      .toEqual(['builtin-party']);
  });

  it('orders tabs: all, imported, market first, then tags by count, simple last', () => {
    const categories = buildTemplateCategories(templates, (tag) => tag === 'custom-tag' ? 'AAA' : tag);
    expect(categories.map(({ id }) => id)).toEqual([
      'all', 'imported', 'market', 'tag:party', 'tag:custom-tag', 'tag:turn-based', 'simple',
    ]);
  });

  it('keeps market second and moves imported to the end zone when its count is zero', () => {
    const noImported = templates.filter((template) => !template.imported);
    const categories = buildTemplateCategories(noImported, (tag) => tag);
    expect(categories.map(({ id }) => id)).toEqual([
      'all', 'market', 'tag:party', 'tag:turn-based', 'tag:custom-tag', 'imported', 'simple',
    ]);
  });

  it('falls back when a selected dynamic category disappears', () => {
    const categories = buildTemplateCategories(templates.filter(({ tags }) => !tags.includes('custom-tag')), (tag) => tag);
    expect(normalizeTemplateCategory('tag:custom-tag', categories)).toBe('all');
  });
});
