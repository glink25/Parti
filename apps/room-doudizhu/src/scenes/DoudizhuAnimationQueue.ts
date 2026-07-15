import type { Card } from '../game/types';

export type DoudizhuAnimation = {
  id: string;
  kind: 'dealStarted' | 'bidPlaced' | 'landlordAssigned' | 'cardsPlayed' | 'playerPassed' | 'trickCleared' | 'multiplierChanged' | 'lowCards' | 'roundSettled';
  duration: number;
  blocking?: boolean;
  actorId?: string;
  cards?: Card[];
  label?: string;
  value?: number;
};

export class DoudizhuAnimationQueue {
  private queue: DoudizhuAnimation[] = [];
  private current: DoudizhuAnimation | null = null;
  private start = 0;
  private ids = new Set<string>();
  private recentIds: string[] = [];

  enqueue(value: DoudizhuAnimation) {
    if (!value.id || this.ids.has(value.id)) return false;
    this.ids.add(value.id); this.recentIds.push(value.id);
    if (this.recentIds.length > 256) this.ids.delete(this.recentIds.shift()!);
    if (this.current && !this.current.blocking) this.current = { ...this.current, duration: Math.min(this.current.duration, 260) };
    this.queue.push(this.queue.length >= 3 ? { ...value, duration: Math.min(value.duration, 240) } : value);
    return true;
  }
  update(now: number): (DoudizhuAnimation & { progress: number }) | null {
    if (!this.current) { this.current = this.queue.shift() ?? null; this.start = now; }
    if (!this.current) return null;
    const progress = Math.min(1, Math.max(0, (now - this.start) / Math.max(1, this.current.duration)));
    if (progress >= 1) { const finishedAt = this.start + this.current.duration; this.current = null; const next = this.update(finishedAt); return next ? this.update(now) : null; }
    return { ...this.current, progress };
  }
  snapshot(now: number): (DoudizhuAnimation & { progress: number }) | null { return this.update(now); }
  presentationAnimations(): DoudizhuAnimation[] { return [...(this.current ? [this.current] : []), ...this.queue]; }
  isInputBlocked() { return Boolean(this.current?.blocking); }
  skipToLatest() { this.queue = []; this.current = null; }
}

export const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;
