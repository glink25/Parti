import type { TileKind } from '../worker/types';

export type ActionFxKind = 'deal' | 'draw' | 'discard' | 'chi' | 'peng' | 'concealedGang' | 'discardGang' | 'addedGang' | 'win' | 'drawGame' | 'scoreChange' | string;
export type ActionFx = {
  actionId?: string;
  occurredAt?: number;
  kind: ActionFxKind;
  actorName: string;
  actorSeat?: number;
  sourceSeat?: number;
  tiles: TileKind[];
  label?: string;
};

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
const SUIT_NAMES = { m: '万', p: '筒', s: '条' } as const;

export function formatTileName(kind: TileKind): string {
  if (kind === 'z') return '红中';
  return `${NUMERALS[Number(kind[1]) - 1]}${SUIT_NAMES[kind[0] as keyof typeof SUIT_NAMES]}`;
}

export function formatActionAnnouncement(event: ActionFx): string {
  const firstTile = event.tiles[0] ? formatTileName(event.tiles[0]) : '牌';
  switch (event.kind) {
    case 'deal': return '牌局开始';
    case 'draw': return `${event.actorName} 摸牌`;
    case 'discard': return `${event.actorName} 出了${firstTile}`;
    case 'chi': return `${event.actorName} 吃了${event.tiles.map(formatTileName).join('、')}`;
    case 'peng': return `${event.actorName} 碰了${firstTile}`;
    case 'concealedGang': return `${event.actorName} 暗杠${firstTile}`;
    case 'discardGang': return `${event.actorName} 点杠${firstTile}`;
    case 'addedGang': return `${event.actorName} 补杠${firstTile}`;
    case 'win': return event.label ?? `${event.actorName} 胡牌`;
    case 'drawGame': return '牌墙耗尽，本局流局';
    default: return `${event.actorName || '玩家'} 完成了操作`;
  }
}
