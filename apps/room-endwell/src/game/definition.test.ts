import { describe, expect, it } from 'vitest';
import type { FlowReducerContext, GameAction } from '@parti/flow';
import type { GameState, SpellSpec } from './contracts';
import { endwellGame } from './definition';
import { positionAt, spawnSpellEntity } from './rules/entities';
import { createCatalyst, generateEquipment } from './rules/equipment';
import { createScroll, resolveScrollSpell } from './rules/scrolls';
import { initialState, player, testMonster } from './rules/state';
import { resolveSpell } from './rules/spells';
import { generateStage, monsterEntity } from './roguelike';

function setup(spell: SpellSpec) { const state = initialState(), p = state.players.p1 = player('p1', 'one', 0), timers: Array<{ action: string; payload: unknown }> = []; state.phase = 'running'; p.cast = { phase: 'chanting', castId: 'p1:cast:1', spell, startedAt: 0, phaseEndsAt: 100, aim: { x: 1, y: 0 }, target: { x: 600, y: 300 } }; const actor = { id: p.id, name: p.name, role: 'host' as const }, ctx: FlowReducerContext<GameState> = { state, role: 'authority', actor, players: [actor], host: actor, now: () => 1000, random: () => .5, timers: { dispatch(_name, _delay, action, payload) { timers.push({ action, payload }); }, clear() {} }, emit() {}, dispatch() {}, kick() {} }; const action = { id: 'a', type: '', payload: null, from: p.id, seq: 1, origin: 'host', createdAt: 0 } as GameAction; return { state, p, ctx, action, timers }; }
describe('delivery activation', () => {
  it('predicts activation through hostRelay and rejects forged early activation', () => { const test = setup(resolveSpell(['fire'])), action = endwellGame.actions['cast.activate']!; expect(action.sync.mode).toBe('hostRelay'); test.p.cast.phaseEndsAt = 1200; expect(action.validate!(test.ctx, { castId: 'p1:cast:1' })).toEqual({ ok: false, reason: 'chanting' }); test.p.cast.phaseEndsAt = 1000; expect(action.validate!(test.ctx, { castId: 'p1:cast:1' }).ok).toBe(true); action.reduce(test.ctx, { castId: 'p1:cast:1' }, test.action); expect(test.p.cast.phase).toBe('active'); expect(test.state.entities['p1:cast:1:spray:0']).toBeDefined(); action.reduce(test.ctx, { castId: 'p1:cast:1' }, test.action); expect(Object.keys(test.state.entities)).toEqual(['p1:cast:1:spray:0']); });
  it('self-heals with one life element and shares discovered special spells', () => { const heal = setup(resolveSpell(['life'])); heal.p.health.current = 55; endwellGame.actions['internal.castActivate']!.reduce(heal.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, heal.action); expect(heal.p.health.current).toBe(75); expect(heal.state.entities).toEqual({}); const special = setup(resolveSpell(['fire', 'life'])); expect(special.state.run.discoveredSpellIds).toEqual(['resurrect']); endwellGame.actions['internal.castActivate']!.reduce(special.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, special.action); expect(special.state.run.discoveredSpellIds).toContain('life-flame'); });
  it('applies shields without spawning a fake hit source', () => { const test = setup(resolveSpell(['fire', 'shield'])); endwellGame.actions['internal.castActivate']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); expect(test.p.shields).toHaveLength(1); expect(test.state.entities).toEqual({}); expect(test.p.cast.phase).toBe('recovery'); });
  it('applies special shield ward statuses', () => { const test = setup(resolveSpell(['shield', 'fire'])); endwellGame.actions['internal.castActivate']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); expect(test.p.shields[0]?.tags).toContain('fireWard'); expect(test.p.statuses.fireWard).toBeDefined(); });
  it('activates instant teleport and resurrection effects', () => {
    const teleport = setup(resolveSpell(['lightning', 'shield', 'lightning']));
    endwellGame.actions['internal.castActivate']!.reduce(teleport.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, teleport.action);
    expect(teleport.p.position).toEqual({ x: 600, y: 300 });
    const resurrect = setup(resolveSpell(['lightning', 'life', 'lightning'])), ally = resurrect.state.players.p2 = player('p2', 'two', 1);
    ally.position = { x: 610, y: 310 };
    ally.alive = false;
    ally.health.current = 0;
    endwellGame.actions['internal.castActivate']!.reduce(resurrect.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, resurrect.action);
    expect(ally.alive).toBe(true);
    expect(ally.health.current).toBe(25);
  });
  it('creates meteor warning then impact', () => { const test = setup(resolveSpell(['fire', 'rock', 'rock', 'fire'])); endwellGame.actions['internal.castActivate']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); expect(test.state.entities['p1:cast:1:warning:0']?.source).toBeUndefined(); endwellGame.actions['internal.areaImpact']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); expect(test.state.entities['p1:cast:1:warning:0']).toBeUndefined(); expect(test.state.entities['p1:cast:1:area:0']?.source?.spell.id).toBe('meteor'); });
  it('starts rain and advances authoritative wet ticks', () => { const test = setup(resolveSpell(['fire', 'water', 'water', 'fire'])); endwellGame.actions['internal.castActivate']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); const environment = test.state.environment.global!; expect(environment.kind).toBe('rain'); for (let i = 0; i < 6; i++) endwellGame.actions['internal.environmentTick']!.reduce(test.ctx, { environmentId: environment.id }, test.action); expect(test.p.statuses.wet).toBeDefined(); expect(test.p.statuses.burning).toBeUndefined(); endwellGame.actions['internal.environmentExpire']!.reduce(test.ctx, { environmentId: environment.id }, test.action); expect(test.state.environment.global).toBeNull(); });
  it('starts blizzard and advances chilled ticks', () => { const test = setup(resolveSpell(['water', 'ice', 'ice', 'water'])); endwellGame.actions['internal.castActivate']!.reduce(test.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, test.action); const environment = test.state.environment.global!; expect(environment.kind).toBe('blizzard'); for (let i = 0; i < 5; i++) endwellGame.actions['internal.environmentTick']!.reduce(test.ctx, { environmentId: environment.id }, test.action); expect(test.p.statuses.chilled).toBeDefined(); });
  it('activates scroll instant effects and black hole fields', () => {
    const supernova = setup(resolveScrollSpell(createScroll('supernova', 'test').elements, Object.assign(player('tmp', 'tmp', 0), { inventory: [createScroll('supernova', 'test')] }), 0)!);
    supernova.state.entities['monster:test'] = { ...player('m', 'monster', 0), id: 'monster:test', kind: 'monster', position: { x: 500, y: 300 }, radius: 30, createdAt: 0, expiresAt: null, detached: true };
    supernova.state.entities['monster:test'].health.current = 400;
    endwellGame.actions['internal.castActivate']!.reduce(supernova.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, supernova.action);
    expect(supernova.p.health.current).toBe(50);
    expect(supernova.state.entities['monster:test']?.health.current).toBe(200);

    const equilibrium = setup(resolveScrollSpell(createScroll('equilibrium', 'test').elements, Object.assign(player('tmp', 'tmp', 0), { inventory: [createScroll('equilibrium', 'test')] }), 0)!);
    equilibrium.p.health.current = 10;
    endwellGame.actions['internal.castActivate']!.reduce(equilibrium.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, equilibrium.action);
    expect(equilibrium.p.health.current).toBe(50);

    const annihilation = setup(resolveScrollSpell(createScroll('annihilation', 'test').elements, Object.assign(player('tmp', 'tmp', 0), { inventory: [createScroll('annihilation', 'test')] }), 0)!);
    annihilation.state.entities['monster:one'] = { ...player('m', 'monster', 0), id: 'monster:one', kind: 'monster', position: { x: 610, y: 300 }, radius: 30, createdAt: 0, expiresAt: null, detached: true };
    annihilation.state.entities['monster:one'].health.current = 500;
    endwellGame.actions['internal.castActivate']!.reduce(annihilation.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, annihilation.action);
    expect(annihilation.state.entities['monster:one']?.health.current).toBeCloseTo(5);

    const blackHole = setup(resolveScrollSpell(createScroll('black-hole', 'test').elements, Object.assign(player('tmp', 'tmp', 0), { inventory: [createScroll('black-hole', 'test')] }), 0)!);
    endwellGame.actions['internal.castActivate']!.reduce(blackHole.ctx, { playerId: 'p1', castId: 'p1:cast:1' }, blackHole.action);
    expect(blackHole.state.entities['p1:cast:1:summon:0']).toMatchObject({ archetype: 'black-hole', radius: 340, source: { tickMs: 500 } });
  });
  it('fully resets transient player and run state when restarting an ended game', () => { const test = setup(resolveSpell(['fire'])); test.state.phase = 'victory'; test.state.hostId = test.p.id; test.p.statuses.wet = { type: 'wet', endsAt: 9000, potency: 1, stacks: 1, tags: [] }; test.p.buildup.burning = 80; test.p.selectedElements = ['fire']; test.p.aim = { x: -1, y: 0 }; test.p.buffs = [{ id: 'buff', sourceId: 'test', endsAt: 9000, stacks: 1, tags: [], modifiers: [] }]; const start = endwellGame.actions['game.start']!; expect(start.validate!(test.ctx, null).ok).toBe(true); start.reduce(test.ctx, null, test.action); expect(test.state.phase).toBe('running'); expect(test.state.run.stageIndex).toBe(0); expect(test.p).toMatchObject({ statuses: {}, buildup: {}, selectedElements: [], aim: { x: 1, y: 0 }, buffs: [], shields: [], inventory: [], equipment: {} }); });
});

describe('cast target modes', () => {
  it('forces self-targeted spells to the caster position', () => { for (const elements of [['life'], ['shield'], ['fire', 'shield', 'fire']] as const) { const test = economySetup(), result = endwellGame.actions['cast.request']!.validate!(test.ctx, { castId: 'p1:cast:1', sequence: 1, elements: [...elements], aim: { x: 1, y: 0 }, target: { x: 9999, y: 9999 } }); expect(result).toMatchObject({ ok: true, payload: { target: test.p.position } }); } });
});

describe('scroll spell priority', () => {
  it('uses owned ready scrolls before normal element resolution and writes cooldown', () => {
    const test = economySetup(), scroll = createScroll('supernova', 'test');
    test.p.inventory.push(scroll);
    endwellGame.actions['cast.request']!.reduce(test.ctx, { castId: 'p1:cast:1', sequence: 1, elements: scroll.elements, aim: { x: 1, y: 0 }, target: { x: 700, y: 300 } }, test.action);
    expect(test.p.cast.spell?.id).toBe('supernova');
    expect(test.p.scrollCooldowns.supernova).toBe(22_000);

    test.p.cast = { phase: 'idle', castId: null, spell: null, startedAt: 0, phaseEndsAt: null, aim: { x: 1, y: 0 }, target: { x: 0, y: 0 } };
    endwellGame.actions['cast.request']!.reduce(test.ctx, { castId: 'p1:cast:2', sequence: 2, elements: scroll.elements, aim: { x: 1, y: 0 }, target: { x: 700, y: 300 } }, test.action);
    expect(test.p.cast.spell?.id).not.toBe('supernova');
  });
});

function economySetup() { const state = initialState(), p = state.players.p1 = player('p1', 'one', 0), stage = generateStage(7, 0), actor = { id: p.id, name: p.name, role: 'host' as const }, timers: Array<{ name: string; delay: number; action: string; payload: unknown; actorId?: string }> = [], events: Array<{ type: string; payload: unknown }> = [], ctx: FlowReducerContext<GameState> = { state, role: 'authority', actor, players: [actor], host: actor, now: () => 2000, random: () => .5, timers: { dispatch(name, delay, action, payload, actorId) { timers.push({ name, delay, action, payload, actorId }); }, clear() {} }, emit(type, payload) { events.push({ type, payload }); }, dispatch() {}, kick() {} }, action = { id: 'a', type: '', payload: null, from: p.id, seq: 1, origin: 'host', createdAt: 0 } as GameAction; state.phase = 'running'; state.run.stage = stage; state.merchant = stage.merchant; state.forge = stage.forge; p.position = { ...stage.world.spawn }; p.gold = 9999; const item = generateEquipment(stage.stageSeed, 99); state.loot['loot:test'] = { id: 'loot:test', position: { ...p.position }, item, droppedByPlayerId: null, ownerPriorityUntil: 0 }; return { state, p, ctx, action, timers, events }; }

describe('death and respawn rules', () => {
  it('kills players, interrupts their cast, and removes owned active sources', () => {
    const test = economySetup(), target = test.state.players.p2 = player('p2', 'two', 1);
    target.health.current = 1;
    target.cast = { phase: 'active', castId: 'p2:cast:1', spell: resolveSpell(['water']), startedAt: 0, phaseEndsAt: 5000, aim: { x: 1, y: 0 }, target: { x: 500, y: 360 } };
    spawnSpellEntity(test.state, target, target.cast.spell!, 1000);
    test.p.cast = { phase: 'active', castId: 'p1:cast:1', spell: resolveSpell(['fire', 'rock']), startedAt: 0, phaseEndsAt: 0, aim: { x: 1, y: 0 }, target: target.position };
    const source = spawnSpellEntity(test.state, test.p, test.p.cast.spell!, 1000);
    endwellGame.actions['combat.hit']!.reduce(test.ctx, { hitId: 'death:player', sourceId: source.id, targetId: target.id, tick: 1, reason: 'hit' }, test.action);
    expect(target.alive).toBe(false);
    expect(target.cast.phase).toBe('idle');
    expect(Object.values(test.state.entities).some((entity) => entity.ownerId === target.id)).toBe(false);
  });

  it('rejects player actions while dead', () => {
    const test = economySetup(), merchant = test.state.merchant!, loot = Object.values(test.state.loot)[0]!, item = loot.item, forge = test.state.forge!;
    test.p.alive = false;
    test.p.inventory.push(item, generateEquipment(4, 1), generateEquipment(4, 2));
    const payloads = [
      ['player.pose', { sequence: 1, sentAt: 2000, position: test.p.position, aim: { x: 1, y: 0 } }],
      ['cast.request', { castId: 'p1:cast:1', sequence: 1, elements: ['fire'], aim: { x: 1, y: 0 }, target: { x: 500, y: 360 } }],
      ['cast.activate', { castId: 'p1:cast:1' }],
      ['cast.aim', { sequence: 1, aim: { x: 1, y: 0 } }],
      ['cast.release', { castId: 'p1:cast:1' }],
      ['inventory.equip', { itemId: item.id }],
      ['inventory.unequip', { itemId: item.id }],
      ['inventory.drop', { itemId: item.id }],
      ['inventory.pickup', { lootId: loot.id }],
      ['merchant.buy', { merchantId: merchant.id, itemId: merchant.stock[0]!.item.id }],
      ['merchant.sell', { merchantId: merchant.id, itemId: item.id }],
      ['forge.fuse', { forgeId: forge.id, itemIds: test.p.inventory.slice(0, 3).map((entry) => entry.id) }],
    ] as const;
    for (const [type, payload] of payloads) expect(endwellGame.actions[type]!.validate!(test.ctx, payload).ok).toBe(false);
  });

  it('rejects hits from dead owners and lets resurrection restore action eligibility', () => {
    const test = economySetup(), ally = test.state.players.p2 = player('p2', 'two', 1);
    test.p.alive = false;
    test.p.cast = { phase: 'active', castId: 'p1:cast:1', spell: resolveSpell(['fire', 'rock']), startedAt: 0, phaseEndsAt: 0, aim: { x: 1, y: 0 }, target: ally.position };
    const source = spawnSpellEntity(test.state, test.p, test.p.cast.spell!, 1000);
    expect(endwellGame.actions['combat.hit']!.validate!(test.ctx, { hitId: 'dead-owner', sourceId: source.id, targetId: ally.id, tick: 1, reason: 'hit' }).ok).toBe(false);

    test.p.position = { x: 610, y: 310 };
    test.p.health.current = 0;
    ally.cast = { phase: 'chanting', castId: 'p2:cast:1', spell: resolveSpell(['lightning', 'life', 'lightning']), startedAt: 0, phaseEndsAt: 100, aim: { x: -1, y: 0 }, target: test.p.position };
    const allyCtx = { ...test.ctx, actor: { id: ally.id, name: ally.name, role: 'player' as const } };
    endwellGame.actions['internal.castActivate']!.reduce(allyCtx, { playerId: ally.id, castId: 'p2:cast:1' }, test.action);
    expect(test.p.alive).toBe(true);
    expect(test.p.health.current).toBe(25);
    expect(endwellGame.actions['player.pose']!.validate!(test.ctx, { sequence: 1, sentAt: 2000, position: test.p.position, aim: { x: 1, y: 0 } }).ok).toBe(true);
  });

  it('removes defeated monsters without restoring training content', () => {
    const test = economySetup(), monster = testMonster(0);
    monster.health.current = 1;
    test.state.entities[monster.id] = monster;
    test.p.cast = { phase: 'active', castId: 'p1:cast:1', spell: resolveSpell(['fire', 'rock']), startedAt: 0, phaseEndsAt: 0, aim: { x: 1, y: 0 }, target: monster.position };
    const source = spawnSpellEntity(test.state, test.p, test.p.cast.spell!, 1000);
    endwellGame.actions['combat.hit']!.reduce(test.ctx, { hitId: 'death:monster', sourceId: source.id, targetId: monster.id, tick: 1, reason: 'hit' }, test.action);
    expect(test.state.entities[monster.id]).toBeUndefined();
    expect(test.timers.some((timer) => timer.action.includes('Respawn'))).toBe(false);
  });
});

describe('force motion integration', () => {
  it('integrates player force velocity over authority ticks and decays it', () => {
    const test = economySetup(), epoch = test.p.positionEpoch, start = { ...test.p.position };
    test.p.forceVelocity = { x: 100, y: 0 };
    endwellGame.systems![0]!.update(test.ctx, .1);
    expect(test.p.position.x).toBeCloseTo(start.x + 10);
    expect(test.p.positionEpoch).toBe(epoch + 1);
    expect(test.p.forceVelocity?.x).toBeLessThan(100);
  });

  it('lets player pose input oppose gravity-like force instead of snapping to the center', () => {
    const test = economySetup(), start = { ...test.p.position };
    test.p.forceVelocity = { x: -100, y: 0 };
    endwellGame.actions['player.pose']!.reduce(test.ctx, { sequence: 1, sentAt: 2000, position: { x: start.x + 30, y: start.y }, aim: { x: 1, y: 0 } }, test.action);
    endwellGame.systems![0]!.update(test.ctx, .1);
    expect(test.p.position.x).toBeGreaterThan(start.x);
    expect(test.p.position.x).toBeLessThan(start.x + 30);
    expect(test.p.forceVelocity?.x).toBeLessThan(0);
  });

  it('integrates monster force velocity without using projectile velocity', () => {
    const test = economySetup(), monster = test.state.entities['monster:test'] = testMonster(0);
    const start = test.state.run.stage!.world.spawn; monster.position = { x: start.x + 100, y: start.y };
    monster.forceVelocity = { x: -80, y: 0 };
    monster.velocity = { x: 999, y: 0 };
    endwellGame.systems![0]!.update(test.ctx, .1);
    expect(monster.position.x).toBeCloseTo(start.x + 92);
    expect(monster.velocity).toEqual({ x: 999, y: 0 });
    expect(monster.forceVelocity?.x).toBeGreaterThan(-80);
  });
});

describe('monster unified casting', () => {
  it('does not deal damage without an active HitSource and exposes chant/recovery', () => { const test = economySetup(), stage = test.state.run.stage!, start = stage.world.spawn, monster = monsterEntity('monster:caster', 'ruins.chaser', 'room-0', { x: start.x + 58, y: start.y }, 1, 0); let now = 2000; test.ctx.now = () => now; test.ctx.dispatch = (type, payload) => { endwellGame.actions[type]!.reduce(test.ctx, payload, test.action); }; test.state.entities[monster.id] = monster; const hp = test.p.health.current; endwellGame.systems![0]!.update(test.ctx, .1); expect(test.p.health.current).toBe(hp); expect(monster.cast.phase).toBe('chanting'); monster.cast.phaseEndsAt = 0; endwellGame.systems![0]!.update(test.ctx, .1); expect(Object.values(test.state.entities).some((entity) => entity.ownerId === monster.id && entity.source?.spell.id === 'ruins-claw')).toBe(true); expect(monster.cast.phase).toBe('recovery'); expect(test.p.health.current).toBe(hp); now += 100; endwellGame.systems![0]!.update(test.ctx, .1); expect(test.p.health.current).toBeLessThan(hp); });
  it('creates a visible lightning projectile before applying ranged damage', () => { const test = economySetup(), stage = test.state.run.stage!, start = stage.world.spawn, monster = monsterEntity('monster:shooter', 'ruins.shooter', 'room-0', { x: start.x + 250, y: start.y }, 1, 0); let now = 2000; test.ctx.now = () => now; test.ctx.dispatch = (type, payload) => { endwellGame.actions[type]!.reduce(test.ctx, payload, test.action); }; test.state.entities[monster.id] = monster; const hp = test.p.health.current; endwellGame.systems![0]!.update(test.ctx, .1); expect(monster.cast.spell?.delivery).toBe('projectile'); monster.cast.phaseEndsAt = 0; endwellGame.systems![0]!.update(test.ctx, .1); const projectile = Object.values(test.state.entities).find((entity) => entity.ownerId === monster.id && entity.kind === 'projectile'); expect(projectile?.source?.spell.payload.damage?.lightning).toBeGreaterThan(0); expect(projectile?.faction.team).toBe('monster'); expect(test.p.health.current).toBe(hp); now += 1000; endwellGame.systems![0]!.update(test.ctx, 1); expect(test.p.health.current).toBeLessThan(hp); });
  it('uses a warning entity before a boss area impact', () => { const test = economySetup(), stage = test.state.run.stage!, start = stage.world.spawn, monster = monsterEntity('monster:boss-caster', 'ruins.boss', 'room-0', { x: start.x + 200, y: start.y }, 1, 0, true, true); test.state.entities[monster.id] = monster; endwellGame.systems![0]!.update(test.ctx, .1); expect(monster.cast.spell?.delivery).toBe('area'); monster.cast.phaseEndsAt = 0; endwellGame.systems![0]!.update(test.ctx, .1); expect(monster.cast.phase).toBe('warning'); expect(Object.values(test.state.entities).some((entity) => entity.kind === 'warning' && entity.ownerId === monster.id)).toBe(true); });
});

describe('authority hit verification', () => {
  it('accepts geometric hits and rejects forged distant targets', () => { const test = economySetup(), spell = resolveSpell(['fire', 'rock']); test.p.cast = { phase: 'active', castId: 'p1:cast:geometry', spell, startedAt: 0, phaseEndsAt: 0, aim: { x: 1, y: 0 }, target: { x: test.p.position.x + spell.range, y: test.p.position.y } }; const source = spawnSpellEntity(test.state, test.p, spell, 1000), target = testMonster(0); target.id = 'monster:geometry'; target.position = positionAt(source, test.ctx.now()); test.state.entities[target.id] = target; const payload = { hitId: 'geometry:valid', sourceId: source.id, targetId: target.id, tick: 1, reason: 'hit' as const }; expect(endwellGame.actions['combat.hit']!.validate!(test.ctx, payload).ok).toBe(true); target.position = { x: source.position.x, y: source.position.y + 900 }; expect(endwellGame.actions['combat.hit']!.validate!(test.ctx, { ...payload, hitId: 'geometry:forged' }).ok).toBe(false); });
});

describe('room encounter pacing', () => {
  it('scales waves once at activation and waits 900ms before every wave', () => { const test = economySetup(), ally = test.state.players.p2 = player('p2', 'two', 1), stage = test.state.run.stage!, encounter = stage.encounters[0]!, room = stage.world.rooms.find((candidate) => candidate.id === encounter.roomId)!; test.p.position = ally.position = { x: room.position.x + room.width / 2, y: room.position.y + room.height / 2 }; let now = 2000; test.ctx.now = () => now; endwellGame.systems![0]!.update(test.ctx, .1); expect(encounter.scaledForPlayers).toBe(2); expect(encounter.waves.map((wave) => wave.length)).toEqual([6, 8, 10]); expect(encounter.currentWave).toBe(0); expect(encounter.nextWaveAt).toBe(2900); now = 2900; endwellGame.systems![0]!.update(test.ctx, .1); expect(encounter.currentWave).toBe(1); for (const id of encounter.waves[0]!) delete test.state.entities[id]; ally.connected = false; now = 3000; endwellGame.systems![0]!.update(test.ctx, .1); expect(encounter.nextWaveAt).toBe(3900); now = 3899; endwellGame.systems![0]!.update(test.ctx, .1); expect(encounter.currentWave).toBe(1); now = 3900; endwellGame.systems![0]!.update(test.ctx, .1); expect(encounter.currentWave).toBe(2); expect(encounter.scaledForPlayers).toBe(2); });
});

describe('economy reducers', () => {
  it('buys and sells near the merchant', () => {
    const test = economySetup(), merchant = test.state.merchant!, entry = merchant.stock[0]!;
    test.p.position = { ...merchant.position };
    endwellGame.actions['merchant.buy']!.reduce(test.ctx, { merchantId: merchant.id, itemId: entry.item.id }, test.action);
    expect(test.p.inventory).toContainEqual(entry.item);
    expect(test.p.gold).toBe(9999 - entry.price);
    endwellGame.actions['merchant.sell']!.reduce(test.ctx, { merchantId: merchant.id, itemId: entry.item.id }, test.action);
    expect(test.p.inventory.some((item) => item.id === entry.item.id)).toBe(false);
    expect(test.p.gold).toBe(9999 - entry.price + Math.floor(entry.item.value * .5));
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
    expect(test.p.gold).toBe(9949);
    expect(test.state.forgeUses[forge.id]?.[test.p.id]).toBe(1);
    expect(test.p.inventory).toHaveLength(1);
    const next = [3, 4].map((index) => ({ ...generateEquipment(10, index), slot: 'staff' as const })), orb = createCatalyst(10, 'test');
    test.p.inventory.push(...next, orb);
    endwellGame.actions['forge.fuse']!.reduce(test.ctx, { forgeId: forge.id, itemIds: [next[0]!.id, next[1]!.id, orb.id] }, test.action);
    expect(test.p.gold).toBe(9849);
    expect(test.state.forgeUses[forge.id]?.[test.p.id]).toBe(2);
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
