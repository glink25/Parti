import { createGameRuntime, createPartiSyncPlugin, type GameRuntime, type StateAdapter } from '@parti/flow';
import type { GameState } from '../game/contracts';
import type { PartiApi } from '../game/contracts';
import { skywardGame } from '../game/definition';
import type { PosePacket } from './network';

export type ShotEvent = { shotId: string; playerId: string; x: number; y: number; damage: number; spread: boolean; pierce: boolean };
export type SkywardFlowHandlers = {
  state(state: GameState): void; pose(packet: PosePacket): void; shot(event: ShotEvent): void;
  localShot(event: { shotId: string; x: number; y: number }): void;
  pickup(event: { playerId: string; kind: string }): void; death(event: { playerId: string; reason: string }): void;
  bossDefeated(event: { chunkIndex: number; ordinal: number }): void; outcome(event: { playerId: string; outcome: string; reason: string }): void;
};
export type SkywardFlow = {
  game: GameRuntime;
  publishPose(payload: Omit<PosePacket, 'playerId' | 'sentAt'> & { cameraBottom: number }): void;
  shoot(payload: { shotId: string; x: number; y: number }): void;
  hitEnemy(payload: object): void; stompEnemy(payload: object): void; landPlatform(payload: object): void;
  claimPickup(payload: object): void; playerOutcome(payload: object): void;
  setReady(ready: boolean): void; restart(): void; enableTilt(enabled: boolean): void;
};

export function createSkywardFlow(api: PartiApi, handlers: SkywardFlowHandlers): SkywardFlow {
  let runtime: GameRuntime | null = null;
  const adapter: StateAdapter = { get: () => undefined, set(path, value) { if (path !== '') return; const state = value as GameState; if (runtime) for (const player of Object.values(state.players)) { if (!runtime.world.has(player.id)) runtime.world.spawn({ id: player.id, type: 'player', components: { Owner: player.id, Transform: { x: player.x, y: player.y }, PlayerState: player } }); else { runtime.world.patchComponent(player.id, 'Transform', { x: player.x, y: player.y }); runtime.world.setComponent(player.id, 'PlayerState', player); } } handlers.state(state); } };
  const game = runtime = createGameRuntime(skywardGame, { role: 'client', playerId: api.playerId ?? 'pending', stateAdapter: adapter });
  game.events.on<PosePacket>('skyward.pose', handlers.pose);
  game.events.on<ShotEvent>('skyward.shot', (payload) => { if (!game.world.has(payload.shotId)) game.world.spawn({ id: payload.shotId, type: 'projectile', components: { Transform: { x: payload.x, y: payload.y }, Owner: payload.playerId, Lifetime: 1.6 } }); if (payload.playerId === game.playerId) handlers.localShot(payload); else handlers.shot(payload); });
  game.events.on<{ playerId: string; kind: string }>('skyward.pickup', handlers.pickup);
  game.events.on<{ playerId: string; reason: string }>('skyward.death', handlers.death);
  game.events.on<{ chunkIndex: number; ordinal: number }>('skyward.bossDefeated', handlers.bossDefeated);
  game.events.on<{ playerId: string; outcome: string; reason: string }>('skyward.outcome', handlers.outcome);
  game.state.define('players.*.position', { sync: { mode: 'ownerInterval', intervalMs: 100, remoteApply: 'smooth' } });
  game.state.define('players.*.alive', { sync: { mode: 'hostInterval', remoteApply: 'replace' } });
  game.state.define('entities', { sync: { mode: 'hostInterval', remoteApply: 'replace' } });
  game.state.define('boss', { sync: { mode: 'hostInterval', remoteApply: 'replace' } });
  game.use(createPartiSyncPlugin(api));
  game.addSystem({ update(ctx, dt) { for (const id of ctx.world.entitiesWith('Lifetime')) { const life = (ctx.world.getComponent<number>(id, 'Lifetime') ?? 0) - dt; if (life <= 0) ctx.world.destroy(id); else ctx.world.setComponent(id, 'Lifetime', life); } } });
  return { game,
    publishPose: (payload) => { game.action('publishPose', payload); }, shoot: (payload) => { game.action('shoot', payload); },
    hitEnemy: (payload) => { game.action('hitEnemy', payload); }, stompEnemy: (payload) => { game.action('stompEnemy', payload); }, landPlatform: (payload) => { game.action('landPlatform', payload); },
    claimPickup: (payload) => { game.action('claimPickup', payload); }, playerOutcome: (payload) => { game.action('playerOutcome', payload); },
    setReady: (ready) => { game.action('setReady', { ready }); }, restart: () => { game.action('restart', null); }, enableTilt: (enabled) => { game.action('enableTilt', { enabled }); },
  };
}
