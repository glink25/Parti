/** 极简类型化事件发射器，供 Runtime 内部与 DevTools 订阅使用。 */
export type Listener<T> = (value: T) => void;

export class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
