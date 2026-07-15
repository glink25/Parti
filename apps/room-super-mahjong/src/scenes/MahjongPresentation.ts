import type { RoundResult } from '../game/types';
import type { Tile } from '../worker/types';
import type { ActiveMahjongAnimation, MahjongAnimation } from './MahjongAnimationQueue';

export function findAddedTile(previous: Tile[], next: Tile[]): Tile | null {
  const previousIds = new Set(previous.map((tile) => tile.id));
  const added = next.filter((tile) => !previousIds.has(tile.id));
  return added.length === 1 ? added[0]! : null;
}

export function mahjongPresentationMask(animation: ActiveMahjongAnimation | null, mySeat: number, queued:MahjongAnimation[] = animation ? [animation] : []) {
  const draws = queued.filter(item => item.kind === 'draw' && item.actorSeat === mySeat && item.drawnTile);
  return {
    hiddenHandTileIds: new Set(draws.map(item=>item.drawnTile!.id)),
    hiddenDiscardCounts: queued.filter(item=>item.kind==='discard').reduce((counts,item)=>counts.set(item.actorSeat??-1,(counts.get(item.actorSeat??-1)??0)+1),new Map<number,number>()),
    hiddenMeldSeats: new Set(queued.filter(item=>['chi','peng','concealedGang','discardGang','addedGang'].includes(item.kind)).map(item=>item.actorSeat??-1)),
    hiddenSettlement: animation?.kind === 'win' || animation?.kind === 'drawGame',
  };
}

export function settlementScores(scores: number[], result: RoundResult, roundStartScores?: number[]) {
  return scores.map((total, seat) => { const before=roundStartScores?.[seat]??total-(result.deltas[seat]??0);return { seat, delta: total-before, before, total }; });
}
