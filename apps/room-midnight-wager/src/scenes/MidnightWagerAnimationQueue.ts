import type { Card, ShotResult } from '../game/types';

export type WagerAnimation = {
  id: string;
  kind: 'cardsCommitted' | 'reveal' | 'shots' | 'specialResolved' | 'roundSettled';
  duration: number;
  blocking?: boolean;
  actorId?: string;
  count?: number;
  cards?: Card[];
  shots?: ShotResult[];
  label?: string;
};

export class MidnightWagerAnimationQueue {
  private queue: WagerAnimation[] = [];
  private active: WagerAnimation | null = null;
  private started = 0;
  private seen = new Set<string>();
  private recentIds: string[] = [];
  enqueue(value: WagerAnimation) {
    if (!value.id || this.seen.has(value.id)) return false;
    this.seen.add(value.id); this.recentIds.push(value.id);
    if (this.recentIds.length > 256) this.seen.delete(this.recentIds.shift()!);
    if (this.active && !this.active.blocking) this.active = { ...this.active, duration: Math.min(this.active.duration, 260) };
    this.queue.push(this.queue.length >= 3 ? { ...value, duration: Math.min(value.duration, 240) } : value);
    return true;
  }
  update(now: number): (WagerAnimation & { progress: number }) | null {
    if (!this.active) { this.active = this.queue.shift() ?? null; this.started = now; }
    if (!this.active) return null;
    const progress = Math.min(1, Math.max(0, (now - this.started) / Math.max(1, this.active.duration)));
    if (progress >= 1) { const finishedAt = this.started + this.active.duration; this.active = null; const next = this.update(finishedAt); return next ? this.update(now) : null; }
    return { ...this.active, progress };
  }
  snapshot(now: number): (WagerAnimation & { progress: number }) | null { return this.update(now); }
  presentationAnimations(): WagerAnimation[] { return [...(this.active ? [this.active] : []), ...this.queue]; }
  isInputBlocked() { return Boolean(this.active?.blocking); }
  skipToLatest() { this.queue = []; this.active = null; }
}

export const easeInOutCubic = (value: number) => value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
