import type { GameState } from '../game/contracts';

export function restartControl(state: Pick<GameState, 'phase' | 'hostId'>, playerId: string) {
  const ended = state.phase === 'gameover' || state.phase === 'victory';
  return { visible: ended, enabled: ended && state.hostId === playerId, label: state.hostId === playerId ? '重新开始游戏' : '等待房主重新开始' };
}
