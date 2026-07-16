import type { TemplateListEntry } from './rooms';

export type TemplateCategoryId = 'all' | 'imported' | 'simple' | `tag:${string}`;

export const KNOWN_TAG_ORDER = [
  'tabletop', 'party', 'role-playing', 'action', 'turn-based', 'co-op',
] as const;

const SIMPLE_TEMPLATE_IDS = new Set(['chat', 'counter']);

export interface TemplateCategory {
  id: TemplateCategoryId;
  tagId?: string;
  count: number;
}

export function templatesInCategory(templates: TemplateListEntry[], categoryId: TemplateCategoryId) {
  if (categoryId === 'all') return templates;
  if (categoryId === 'imported') return templates.filter((template) => template.imported);
  if (categoryId === 'simple') return templates.filter((template) => SIMPLE_TEMPLATE_IDS.has(template.id));
  const tagId = categoryId.slice(4);
  return templates.filter((template) => template.tags.includes(tagId));
}

export function buildTemplateCategories(
  templates: TemplateListEntry[],
  displayTag: (tagId: string) => string,
): TemplateCategory[] {
  const tags = new Set(templates.flatMap((template) => template.tags));
  const knownIndex = new Map<string, number>(KNOWN_TAG_ORDER.map((tag, index) => [tag, index]));

  const allCategory: TemplateCategory = { id: 'all', count: templates.length };
  const importedCategory: TemplateCategory = {
    id: 'imported',
    count: templates.filter((template) => template.imported).length,
  };
  const simpleCategory: TemplateCategory = {
    id: 'simple',
    count: templates.filter((template) => SIMPLE_TEMPLATE_IDS.has(template.id)).length,
  };

  const tagCategories = [...tags]
    .map((tagId) => ({
      id: `tag:${tagId}` as const,
      tagId,
      count: templates.filter((template) => template.tags.includes(tagId)).length,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const ai = knownIndex.get(a.tagId!);
      const bi = knownIndex.get(b.tagId!);
      if (ai !== undefined || bi !== undefined) {
        return (ai ?? Number.MAX_SAFE_INTEGER) - (bi ?? Number.MAX_SAFE_INTEGER);
      }
      return displayTag(a.tagId!).localeCompare(displayTag(b.tagId!));
    });

  if (importedCategory.count > 0) {
    return [allCategory, importedCategory, ...tagCategories, simpleCategory];
  }
  return [allCategory, ...tagCategories, importedCategory, simpleCategory];
}

export function normalizeTemplateCategory(categoryId: TemplateCategoryId, categories: TemplateCategory[]) {
  return categories.some((category) => category.id === categoryId) ? categoryId : 'all';
}
