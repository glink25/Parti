export class Registry<T extends { id: string }> {
  private items = new Map<string, T>();
  register(item: T) { if (this.items.has(item.id)) throw new Error(`Duplicate strategy id: ${item.id}`); this.items.set(item.id, item); return this; }
  require(id: string) { const item = this.items.get(id); if (!item) throw new Error(`Unknown strategy id: ${id}`); return item; }
  values() { return [...this.items.values()].sort((a, b) => a.id.localeCompare(b.id)); }
}
