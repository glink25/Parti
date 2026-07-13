import { defineRoom, type RoomContext } from '@parti/worker-sdk';
import { applyCommand, createMatch } from '../game/rules';
import type {
  Command,
  GameSession,
  GameState,
  MatchPlayerInput,
  Ruleset,
  SecretState,
  Transition,
} from '../game/types';

let secret: SecretState = emptySecret();

function emptySecret(): SecretState {
  return { hands: {}, deck: [], pile: [], fatalPulls: {}, shotTargets: {} };
}

function isRestorableState(state: unknown): state is GameState {
  if (!state || typeof state !== 'object') return false;
  const candidate = state as Partial<GameState>;
  return (
    typeof candidate.hostId === 'string' &&
    typeof candidate.players === 'object' &&
    candidate.players !== null &&
    Array.isArray(candidate.seats)
  );
}

function replaceState(target: GameState, source: GameState) {
  if (target === source) return;
  for (const key of Object.keys(target) as Array<keyof GameState>) delete target[key];
  Object.assign(target, source);
}

function session(ctx: RoomContext<GameState>): GameSession {
  return { state: ctx.state, secret };
}

function emitTransition(ctx: RoomContext<GameState>, result: Transition) {
  replaceState(ctx.state, result.session.state);
  secret = result.session.secret;
  for (const effect of result.sends) ctx.send(effect.playerId, effect.event, effect.payload);
  for (const effect of result.broadcasts) ctx.broadcast(effect.event, effect.payload);
  for (const scheduled of result.schedules) {
    ctx.setTimer(scheduled.name, scheduled.ms, () => dispatch(ctx, scheduled.command));
  }
}

function dispatch(ctx: RoomContext<GameState>, command: Command) {
  emitTransition(ctx, applyCommand(session(ctx), command, () => ctx.random()));
}

function asPlayer(player: { id: string; name: string; role: 'host' | 'player' | 'spectator' }): MatchPlayerInput {
  return {
    id: player.id,
    name: player.name,
    role: player.role === 'host' ? 'host' : 'player',
  };
}

function resetAfterRestore(ctx: RoomContext<GameState>) {
  secret = emptySecret();
  if (!isRestorableState(ctx.state)) {
    const players = ctx.players
      .filter((player) => player.role !== 'spectator')
      .map(asPlayer);
    const hostId = ctx.host?.id ?? players.find((player) => player.role === 'host')?.id ?? players[0]?.id ?? '';
    const recovered = createMatch(
      { hostId, players, ruleset: 'classic', start: false },
      () => ctx.random(),
    );
    recovered.state.message = '房间状态已修复，请重新准备';
    replaceState(ctx.state, recovered.state);
    return;
  }
  const restored = createMatch(
    {
      hostId: ctx.state.hostId,
      players: ctx.state.seats
        .map((id) => (id ? ctx.state.players[id] : null))
        .filter((player): player is GameState['players'][string] => Boolean(player))
        .map((player) => ({
          id: player.id,
          name: player.name,
          role: player.role,
          wins: player.wins,
        })),
      ruleset: ctx.state.ruleset,
      start: false,
    },
    () => ctx.random(),
  );
  restored.state.message = '房间已恢复，上一局因隐藏信息失效而中止';
  replaceState(ctx.state, restored.state);
}

export default defineRoom<GameState>({
  meta: { name: '午夜赌局', minPlayers: 2, maxPlayers: 4 },

  initialState() {
    secret = emptySecret();
    return createMatch({ hostId: '', players: [], ruleset: 'classic', start: false }, Math.random).state;
  },

  onRestore(ctx) {
    resetAfterRestore(ctx);
  },

  onJoin(ctx, player) {
    if (ctx.state.phase !== 'lobby' && !ctx.state.players[player.id]) {
      ctx.kick(player.id, '牌局进行中，暂不开放新席位');
      return;
    }
    dispatch(ctx, { type: 'playerJoined', actorId: player.id, player: asPlayer(player) });
  },

  onReconnect(ctx, player) {
    dispatch(ctx, { type: 'playerReconnected', actorId: player.id, name: player.name });
  },

  onLeave(ctx, player) {
    dispatch(ctx, { type: 'playerLeft', actorId: player.id });
  },

  onReady(ctx, player) {
    dispatch(ctx, { type: 'syncPrivate', actorId: player.id });
  },

  actions: {
    setReady(ctx, { player, payload }) {
      dispatch(ctx, { type: 'setReady', actorId: player.id, ready: Boolean(payload?.ready) });
    },
    setRuleset(ctx, { player, payload }) {
      const ruleset = payload?.ruleset;
      if (ruleset !== 'classic' && ruleset !== 'devil' && ruleset !== 'chaos') {
        ctx.send(player.id, 'game:invalid', { message: '未知规则' });
        return;
      }
      dispatch(ctx, { type: 'setRuleset', actorId: player.id, ruleset: ruleset as Ruleset });
    },
    playCards(ctx, { player, payload }) {
      const cardIds = Array.isArray(payload?.cardIds)
        ? payload.cardIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      dispatch(ctx, { type: 'playCards', actorId: player.id, cardIds });
    },
    callLiar(ctx, { player }) {
      dispatch(ctx, { type: 'callLiar', actorId: player.id });
    },
    callDevilsDeal(ctx, { player }) {
      dispatch(ctx, { type: 'callDevilsDeal', actorId: player.id });
    },
    pullTrigger(ctx, { player, payload }) {
      dispatch(ctx, {
        type: 'pullTrigger',
        actorId: player.id,
        targetId: typeof payload?.targetId === 'string' ? payload.targetId : undefined,
      });
    },
    syncPrivate(ctx, { player }) {
      dispatch(ctx, { type: 'syncPrivate', actorId: player.id });
    },
    abortMatch(ctx, { player }) {
      if (player.id === ctx.state.hostId) ctx.clearTimer('resolution');
      dispatch(ctx, { type: 'abortMatch', actorId: player.id });
    },
  },
});
