export type MahjongAnimation = {
  id: string;
  kind: string;
  duration: number;
  blocking?: boolean;
  actorSeat?: number;
  sourceSeat?: number;
  tiles?: string[];
  label?: string;
  drawnTile?: { id: string; kind: string };
};

export type ActiveMahjongAnimation = MahjongAnimation & { progress: number };

export class MahjongAnimationQueue {
  private pending: MahjongAnimation[] = [];
  private active: MahjongAnimation | null = null;
  private startedAt = 0;
  private seen = new Set<string>();
  private recentIds: string[] = [];

  enqueue(animation: MahjongAnimation) {
    if (!animation.id || this.seen.has(animation.id)) return false;
    this.seen.add(animation.id); this.recentIds.push(animation.id);
    if (this.recentIds.length > 256) this.seen.delete(this.recentIds.shift()!);
    if (this.active && !this.active.blocking) this.active = { ...this.active, duration: Math.min(this.active.duration, 260) };
    if (this.pending.length >= 3) animation = { ...animation, duration: Math.min(animation.duration, 240) };
    this.pending.push(animation);
    return true;
  }

  update(now: number): ActiveMahjongAnimation | null {
    if (!this.active) {
      this.active = this.pending.shift() ?? null;
      this.startedAt = now;
    }
    if (!this.active) return null;
    const progress = Math.min(1, Math.max(0, (now - this.startedAt) / Math.max(1, this.active.duration)));
    if (progress >= 1) {
      const finishedAt = this.startedAt + this.active.duration;
      this.active = null;
      const next = this.update(finishedAt);
      return next ? this.update(now) : null;
    }
    return { ...this.active, progress };
  }

  snapshot(now: number) { return this.update(now); }
  presentationAnimations(): MahjongAnimation[] { return [...(this.active ? [this.active] : []), ...this.pending]; }
  isInputBlocked() { return Boolean(this.active?.blocking); }
  skipToLatest() { this.pending = []; this.active = null; }
}

export const easeOutBack = (value: number) => {
  const c = 1.70158, x = value - 1;
  return 1 + (c + 1) * x ** 3 + c * x ** 2;
};
