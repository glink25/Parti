import { hashText } from './random';

export class Registry<T extends { id: string; version?: number }> {
  private items = new Map<string, T>();
  register(item: T) { if (this.items.has(item.id)) throw new Error(`Duplicate strategy id: ${item.id}`); if (item.version != null && (!Number.isInteger(item.version) || item.version < 1)) throw new Error(`Invalid strategy version: ${item.id}`); this.items.set(item.id, item); return this; }
  require(id: string) { const item = this.items.get(id); if (!item) throw new Error(`Unknown strategy id: ${id}`); return item; }
  values() { return [...this.items.values()].sort((a, b) => a.id.localeCompare(b.id)); }
  manifest(namespace: string) { return this.values().map((item) => `${namespace}:${item.id}@${item.version ?? 1}`); }
}

export function contentFingerprint(registries: Array<{ manifest(namespace: string): string[] }>, namespaces: string[]) {
  const manifest = registries.flatMap((registry, index) => registry.manifest(namespaces[index] ?? String(index))).sort();
  return hashText(manifest.join('|')).toString(16).padStart(8, '0');
}
