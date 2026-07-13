import { describe, expect, it } from 'vitest';
import { computeLobbyLayout, computeTableLayout, overlaps } from './MahjongLayout';

const sizes = [
  ['desktop landscape', 1280, 720],
  ['tablet landscape', 1024, 600],
  ['phone portrait', 390, 844],
  ['short landscape', 844, 390],
] as const;

describe('mahjong responsive layout', () => {
  it.each(sizes)('keeps lobby content separated on %s', (_, width, height) => {
    const layout = computeLobbyLayout(width, height);
    expect(layout.seatCards).toHaveLength(4);
    expect(layout.ruleCards).toHaveLength(8);
    expect(overlaps(layout.rulesArea, layout.actionBar)).toBe(false);
    for (const rect of [...layout.seatCards, ...layout.ruleCards, layout.actionBar]) {
      expect(rect.x).toBeGreaterThanOrEqual(8);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(width - 8);
      expect(rect.y + rect.h).toBeLessThanOrEqual(height - 8);
    }
  });

  it.each(sizes)('keeps table zones visible and interactive controls out of the capsule on %s', (_, width, height) => {
    const layout = computeTableLayout(width, height, 15);
    expect(layout.seats).toHaveLength(4);
    expect(layout.rivers).toHaveLength(4);
    expect(layout.hand.tileWidth).toBeGreaterThanOrEqual(20);
    expect(layout.hand.startX).toBeGreaterThanOrEqual(8);
    expect(layout.hand.startX + layout.hand.totalWidth).toBeLessThanOrEqual(width - 8);
    expect(overlaps(layout.actions, layout.hand.rect)).toBe(false);
    expect(overlaps(layout.actions, layout.capsuleSafeArea)).toBe(false);
    expect(layout.hud.h).toBeGreaterThan(0);
  });

  it('uses four lobby columns in landscape and two in portrait', () => {
    expect(computeLobbyLayout(1280, 720).columns).toBe(4);
    expect(computeLobbyLayout(390, 844).columns).toBe(2);
  });

  it('shows three activity lines in landscape and one in portrait', () => {
    expect(computeTableLayout(1280, 720, 14).activityLines).toBe(3);
    expect(computeTableLayout(390, 844, 14).activityLines).toBe(1);
  });
});
