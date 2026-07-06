import { describe, expect, it } from 'vitest';
import type { FlowReducerContext, GameAction } from '@parti/flow';
import type { GameState, SpellSpec } from './contracts';
import { endwellGame } from './definition';
import { createCatalyst, generateEquipment } from './rules/equipment';
import { initialState, player } from './rules/state';
import { resolveSpell } from './rules/spells';

function setup(spell: SpellSpec) { const state = initialState(), p = state.players.p1 = player('p1', 'one', 0), timers: Array<{ action: string; payload: unknown }> = []; state.phase = 'running'; p.cast = { phase: 'chanting', castId: 'p1:cast:1', spell, startedAt: 0, phaseEndsAt: 100, aim: { x: 1, y: 0 }, target: { x: 600, y: 300 } }; const actor = { id: p.id, name: p.name, role: 'host' as const }, ctx: FlowReducerContext<GameState> = { state, role: 'authority', actor, players: [actor], host: actor, now: () => 1000, random: () => .5, timers: { dispatch(_name, _delay, action, payload) { timers.push({ action, payload }); }, clear() {} }, emit() {}, dispatch() {}, kick() {} }; const action = { id: 'a', type: '', payload: null, from: p.id, seq: 1, origin: 'host', createdAt: 0 } as GameAction; return { state, p, ctx, action, timers }; }
describe('delivery activation', () => {
  it('applies shields without spawning a fake hit source', () => { const test = setup(resolveSpell(['fire', 'shield'])); endwellGame.actions['internal.castActivate']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); expect(test.p.shields).toHaveLength(1); expect(test.state.entities).toEqual({}); expect(test.p.cast.phase).toBe('recovery'); });
  it('creates meteor warning then impact', () => { const test = setup(resolveSpell(['fire', 'rock', 'rock', 'fire'])); endwellGame.actions['internal.castActivate']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); expect(test.state.entities['p1:cast:1:warning:0']?.source).toBeUndefined(); endwellGame.actions['internal.areaImpact']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); expect(test.state.entities['p1:cast:1:warning:0']).toBeUndefined(); expect(test.state.entities['p1:cast:1:area:0']?.source?.spell.id).toBe('meteor'); });
  it('starts rain and advances authoritative wet ticks', () => { const test = setup(resolveSpell(['fire', 'water', 'water', 'fire'])); endwellGame.actions['internal.castActivate']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); const environment = test.state.environment.global!; expect(environment.kind).toBe('rain'); for (let i = 0; i < 6; i++) endwellGame.actions['internal.environmentTick']!.reduce(test.ctx, { environmentId: environment.id }, test.action); expect(test.p.statuses.wet).toBeDefined(); expect(test.p.statuses.burning).toBeUndefined(); endwellGame.actions['internal.environmentExpire']!.reduce(test.ctx, { environmentId: environment.id }, test.action); expect(test.state.environment.global).toBeNull(); });
});

function economySetup() { const state = initialState(), p = state.players.p1 = player('p1', 'one', 0), actor = { id: p.id, name: p.name, role: 'host' as const }, ctx: FlowReducerContext<GameState> = { state, role: 'authority', actor, players: [actor], host: actor, now: () => 2000, random: () => .5, timers: { dispatch() {}, clear() {} }, emit() {}, dispatch() {}, kick() {} }, action = { id: 'a', type: '', payload: null, from: p.id, seq: 1, origin: 'host', createdAt: 0 } as GameAction; state.phase = 'running'; return { state, p, ctx, action }; }

describe('economy reducers', () => {
  it('buys and sells near the merchant', () => {
    const test = economySetup(), merchant = test.state.merchant!, entry = merchant.stock[0]!;
    test.p.position = { ...merchant.position };
    endwellGame.actions['merchant.buy']!.reduce(test.ctx, { merchantId: merchant.id, itemId: entry.item.id }, test.action);
    expect(test.p.inventory).toContainEqual(entry.item);
    expect(test.p.gold).toBe(120 - entry.price);
    endwellGame.actions['merchant.sell']!.reduce(test.ctx, { merchantId: merchant.id, itemId: entry.item.id }, test.action);
    expect(test.p.inventory.some((item) => item.id === entry.item.id)).toBe(false);
    expect(test.p.gold).toBe(120 - entry.price + Math.floor(entry.item.value * .5));
  });

  it('picks up and drops nearby loot', () => {
    const test = economySetup(), loot = Object.values(test.state.loot)[0]!;
    test.p.position = { ...loot.position };
    endwellGame.actions['inventory.pickup']!.reduce(test.ctx, { lootId: loot.id }, test.action);
    expect(test.state.loot[loot.id]).toBeUndefined();
    expect(test.p.inventory).toContainEqual(loot.item);
    endwellGame.actions['inventory.drop']!.reduce(test.ctx, { itemId: loot.item.id }, test.action);
    expect(test.p.inventory).toHaveLength(0);
    expect(Object.values(test.state.loot).some((entry) => entry.item.id === loot.item.id)).toBe(true);
  });

  it('equips and unequips inventory equipment', () => {
    const test = economySetup(), staff = { ...generateEquipment(3, 1), slot: 'staff' as const };
    test.p.inventory.push(staff);
    endwellGame.actions['inventory.equip']!.reduce(test.ctx, { itemId: staff.id }, test.action);
    expect(test.p.equipment.staff?.id).toBe(staff.id);
    expect(test.p.inventory).toHaveLength(0);
    endwellGame.actions['inventory.unequip']!.reduce(test.ctx, { itemId: staff.id }, test.action);
    expect(test.p.equipment.staff).toBeUndefined();
    expect(test.p.inventory[0]?.id).toBe(staff.id);
  });

  it('fuses items with increasing per-player forge prices', () => {
    const test = economySetup(), forge = test.state.forge!;
    test.p.position = { ...forge.position };
    test.p.inventory = [0, 1, 2].map((index) => ({ ...generateEquipment(10, index), slot: 'staff' as const }));
    endwellGame.actions['forge.fuse']!.reduce(test.ctx, { forgeId: forge.id, itemIds: test.p.inventory.map((item) => item.id) }, test.action);
    expect(test.p.gold).toBe(70);
    expect(test.state.forgeUses[forge.id]?.[test.p.id]).toBe(1);
    expect(test.p.inventory).toHaveLength(1);
    const next = [3, 4].map((index) => ({ ...generateEquipment(10, index), slot: 'staff' as const })), orb = createCatalyst(10, 'test');
    test.p.inventory.push(...next, orb);
    endwellGame.actions['forge.fuse']!.reduce(test.ctx, { forgeId: forge.id, itemIds: [next[0]!.id, next[1]!.id, orb.id] }, test.action);
    expect(test.p.gold).toBe(70);
    expect(test.state.forgeUses[forge.id]?.[test.p.id]).toBe(1);
  });

  it('drops fusion result when backpack was full before fusing', () => {
    const test = economySetup(), forge = test.state.forge!;
    test.p.position = { ...forge.position };
    test.p.gold = 200;
    test.p.inventory = [0, 1, 2].map((index) => ({ ...generateEquipment(20, index), slot: 'ring' as const }));
    for (let i = 0; i < 6; i++) test.p.inventory.push({ ...generateEquipment(30, i), id: `filler:${i}` });
    endwellGame.actions['forge.fuse']!.reduce(test.ctx, { forgeId: forge.id, itemIds: test.p.inventory.slice(0, 3).map((item) => item.id) }, test.action);
    expect(test.p.inventory).toHaveLength(6);
    expect(Object.values(test.state.loot).some((entry) => entry.id.startsWith('fusion:'))).toBe(true);
  });
});
