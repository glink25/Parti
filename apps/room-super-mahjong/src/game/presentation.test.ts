import { describe, expect, it } from 'vitest';
import { formatActionAnnouncement, formatTileName } from './presentation';

describe('mahjong presentation', () => {
  it('formats familiar Chinese tile names', () => {
    expect(formatTileName('m1')).toBe('一万');
    expect(formatTileName('p9')).toBe('九筒');
    expect(formatTileName('s1')).toBe('一条');
    expect(formatTileName('z')).toBe('红中');
  });

  it('formats natural action announcements without exposing action ids', () => {
    expect(formatActionAnnouncement({ kind: 'discard', actorName: '雀侠 2', tiles: ['p3'] })).toBe('雀侠 2 出了三筒');
    expect(formatActionAnnouncement({ kind: 'chi', actorName: '阿明', tiles: ['s2', 's3', 's4'] })).toBe('阿明 吃了二条、三条、四条');
    expect(formatActionAnnouncement({ kind: 'peng', actorName: '阿青', tiles: ['m5'] })).toBe('阿青 碰了五万');
    expect(formatActionAnnouncement({ kind: 'concealedGang', actorName: '阿红', tiles: ['p8'] })).toBe('阿红 暗杠八筒');
    expect(formatActionAnnouncement({ kind: 'discardGang', actorName: '阿红', tiles: ['m6'] })).toBe('阿红 点杠六万');
    expect(formatActionAnnouncement({ kind: 'addedGang', actorName: '阿红', tiles: ['s7'] })).toBe('阿红 补杠七条');
  });

  it('uses a safe Chinese fallback for unknown presentation events', () => {
    expect(formatActionAnnouncement({ kind: 'future-action', actorName: '阿明', tiles: [] })).toBe('阿明 完成了操作');
  });
});
