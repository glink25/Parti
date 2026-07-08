import type { SpellSpec, StatModifier } from '../contracts';

export function applySpellModifiers(spell: SpellSpec, modifiers: StatModifier[]): SpellSpec {
  const result = structuredClone(spell) as SpellSpec;
  const ordered = [...modifiers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  for (const modifier of ordered) {
    const path = modifier.stat.split('.'); let target: Record<string, unknown> = result as unknown as Record<string, unknown>;
    for (const key of path.slice(0, -1)) { const next = target[key]; if (!next || typeof next !== 'object') break; target = next as Record<string, unknown>; }
    const key = path.at(-1)!; const current = target[key];
    if (modifier.op === 'override') target[key] = modifier.value;
    else if (typeof current === 'number' && typeof modifier.value === 'number') target[key] = modifier.op === 'add' ? current + modifier.value : modifier.op === 'multiply' ? current * modifier.value : modifier.op === 'min' ? Math.min(current, modifier.value) : Math.max(current, modifier.value);
  }
  return result;
}
