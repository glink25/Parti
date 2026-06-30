/** 玩家模型与玩家管理 (GOAL.md §4, §15) */
import type { WelcomePlayer } from './protocol/messages.js';
import type { PlayerRole, PlayerStatus } from './protocol/messages.js';
import type { PeerId } from './transport/types.js';

export type { PlayerRole, PlayerStatus };

export interface Player {
  id: string;
  /** 底层 transport peer id（host 自身的本地玩家可与 selfId 一致）。 */
  peerId: PeerId;
  /** 稳定客户端身份 id（跨刷新/掉线），用于重连时复用 playerId。 */
  clientId?: string;
  name: string;
  role: PlayerRole;
  status: PlayerStatus;
  avatar?: string;
  joinedAt: number;
}

/** 维护房间内玩家列表。Host 持有权威列表。 */
export class PlayerManager {
  private readonly players = new Map<string, Player>();
  private readonly byPeer = new Map<PeerId, string>();
  private readonly byClient = new Map<string, string>();

  add(player: Player): Player {
    this.players.set(player.id, player);
    this.byPeer.set(player.peerId, player.id);
    if (player.clientId) this.byClient.set(player.clientId, player.id);
    return player;
  }

  remove(playerId: string): Player | undefined {
    const player = this.players.get(playerId);
    if (player) {
      this.players.delete(playerId);
      this.byPeer.delete(player.peerId);
      if (player.clientId) this.byClient.delete(player.clientId);
    }
    return player;
  }

  get(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  getByPeer(peerId: PeerId): Player | undefined {
    const id = this.byPeer.get(peerId);
    return id ? this.players.get(id) : undefined;
  }

  getByClient(clientId: string): Player | undefined {
    const id = this.byClient.get(clientId);
    return id ? this.players.get(id) : undefined;
  }

  /** 重连时把玩家重新绑定到新的 transport peer（旧 peer 映射被替换）。 */
  rebindPeer(playerId: string, newPeerId: PeerId): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.byPeer.delete(player.peerId);
    player.peerId = newPeerId;
    this.byPeer.set(newPeerId, playerId);
  }

  setStatus(playerId: string, status: PlayerStatus): void {
    const player = this.players.get(playerId);
    if (player) player.status = status;
  }

  list(): Player[] {
    return [...this.players.values()];
  }

  count(): number {
    return this.players.size;
  }

  host(): Player | undefined {
    return this.list().find((p) => p.role === 'host');
  }

  /** 转为 welcome 消息所需的精简结构。 */
  toWelcomeList(): WelcomePlayer[] {
    return this.list().map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      status: p.status,
    }));
  }
}
