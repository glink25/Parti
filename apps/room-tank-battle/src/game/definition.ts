import { accept, defineGame, reject } from '@parti/flow';
import type { Direction, GameMode, GameState, Team } from './contracts';
import { MAP_BY_ID } from './maps';
import { canStart, createPlayer, firePlayer, initialState, returnToLobby, startMatch, stepGame } from './rules';

const DIRECTIONS = new Set<Direction>(['up', 'down', 'left', 'right', 'none']);

export const tankBattleDefinition = defineGame<GameState>({
  meta: { name: '像素坦克大战', minPlayers: 2, maxPlayers: 4 },
  initialState,
  lifecycle: {
    join(ctx, player) {
      if (!ctx.state.hostId) ctx.state.hostId = player.id;
      const existing = ctx.state.players[player.id];
      if (existing) { existing.connected = true; return; }
      ctx.state.players[player.id] = createPlayer(player.id, player.name, Object.keys(ctx.state.players).length);
    },
    reconnect(ctx, player) {
      const existing = ctx.state.players[player.id];
      if (existing) existing.connected = true;
    },
    leave(ctx, player) {
      const leaving = ctx.state.players[player.id];
      if (!leaving) return;
      if (ctx.state.phase === 'lobby') delete ctx.state.players[player.id];
      else {
        leaving.connected = false; leaving.alive = false; leaving.eliminated = true; leaving.respawnAt = null; leaving.input = 'none';
        if (ctx.state.config.mode === 'freeForAll' && ctx.state.bases[`player:${player.id}`]) ctx.state.bases[`player:${player.id}`].hp = 0;
      }
      if (ctx.state.hostId === player.id) ctx.state.hostId = Object.values(ctx.state.players).find((candidate) => candidate.connected)?.id ?? null;
    },
  },
  systems: [{
    runOn: 'authority', intervalMs: 50,
    update(ctx) { stepGame(ctx.state, Date.now()); },
  }],
  actions: {
    'lobby.ready': {
      sync: { mode: 'hostRelay' },
      validate(ctx, payload: { ready?: unknown }) {
        if (ctx.state.phase !== 'lobby' || !ctx.state.players[ctx.actor.id] || typeof payload?.ready !== 'boolean') return reject('invalid-ready');
        return accept({ ready: payload.ready });
      },
      reduce(ctx, payload: { ready: boolean }) { ctx.state.players[ctx.actor.id].ready = payload.ready; },
    },
    'lobby.configure': {
      sync: { mode: 'hostAuthoritative' },
      validate(ctx, payload: { mode?: unknown; mapId?: unknown }) {
        if (ctx.state.phase !== 'lobby' || ctx.actor.id !== ctx.state.hostId) return reject('host-only');
        if (payload?.mode !== 'freeForAll' && payload?.mode !== 'team2v2') return reject('invalid-mode');
        if (typeof payload.mapId !== 'string' || !MAP_BY_ID.has(payload.mapId)) return reject('invalid-map');
        return accept({ mode: payload.mode as GameMode, mapId: payload.mapId });
      },
      reduce(ctx, payload: { mode: GameMode; mapId: string }) {
        ctx.state.config = payload;
        Object.values(ctx.state.players).forEach((player) => { player.ready = false; });
      },
    },
    'lobby.team': {
      sync: { mode: 'hostRelay' },
      validate(ctx, payload: { team?: unknown }) {
        if (ctx.state.phase !== 'lobby' || (payload?.team !== 'red' && payload?.team !== 'blue')) return reject('invalid-team');
        const nextTeam = payload.team as Team;
        const occupied = Object.values(ctx.state.players).filter((player) => player.team === nextTeam && player.id !== ctx.actor.id).length;
        return occupied >= 2 ? reject('team-full') : accept({ team: nextTeam });
      },
      reduce(ctx, payload: { team: Team }) { ctx.state.players[ctx.actor.id].team = payload.team; ctx.state.players[ctx.actor.id].ready = false; },
    },
    'game.start': {
      sync: { mode: 'hostAuthoritative' },
      validate(ctx) {
        return ctx.actor.id === ctx.state.hostId && canStart(ctx.state) ? accept(null) : reject('cannot-start');
      },
      reduce(ctx) { startMatch(ctx.state, Date.now()); },
    },
    'player.input': {
      sync: { mode: 'hostRelay' },
      validate(ctx, payload: { direction?: unknown }) {
        const direction = payload?.direction as Direction;
        return ctx.state.phase === 'running' && ctx.state.players[ctx.actor.id]?.alive && DIRECTIONS.has(direction)
          ? accept({ direction }) : reject('invalid-input');
      },
      reduce(ctx, payload: { direction: Direction }) { ctx.state.players[ctx.actor.id].input = payload.direction; },
    },
    'player.fire': {
      sync: { mode: 'hostAuthoritative' },
      validate(ctx) { return ctx.state.phase === 'running' && ctx.state.players[ctx.actor.id]?.alive ? accept(null) : reject('cannot-fire'); },
      reduce(ctx) { firePlayer(ctx.state, ctx.actor.id, Date.now()); },
    },
    'game.rematch': {
      sync: { mode: 'hostAuthoritative' },
      validate(ctx) { return ctx.state.phase === 'finished' && ctx.actor.id === ctx.state.hostId ? accept(null) : reject('host-only'); },
      reduce(ctx) { returnToLobby(ctx.state); },
    },
    'game.returnToLobby': {
      sync: { mode: 'hostAuthoritative' },
      validate(ctx) { return ctx.state.phase === 'finished' && ctx.actor.id === ctx.state.hostId ? accept(null) : reject('host-only'); },
      reduce(ctx) { returnToLobby(ctx.state); },
    },
  },
});
