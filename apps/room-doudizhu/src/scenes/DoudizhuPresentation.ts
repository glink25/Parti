import type { DoudizhuAnimation } from './DoudizhuAnimationQueue';
export function doudizhuPresentationMask(animation: (DoudizhuAnimation & {progress:number}) | null, queued:DoudizhuAnimation[]=animation?[animation]:[]) {
  return { hiddenCenterPlay: queued.some(item=>item.kind==='cardsPlayed'), hiddenLandlordCards: queued.some(item=>item.kind==='landlordAssigned'), hiddenSettlement: animation?.kind === 'roundSettled', keepPreviousTrick: animation?.kind === 'trickCleared' };
}
