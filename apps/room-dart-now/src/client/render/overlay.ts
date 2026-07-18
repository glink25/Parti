/**
 * Overlay：大厅与结算界面。
 * 阶段切换时才挂载/卸载视图根节点；阶段内只更新文本与 keyed 列表。
 */

import { lobbyReadiness, rankPlayers } from '../../shared/lobby';
import type { GamePlayer, GameState } from '../../shared/protocol';

export interface OverlayHooks {
  onToggleReady(): void;
  onStartGame(): void;
  onReturnToLobby(): void;
}

export class Overlay {
  private readonly root: HTMLElement;
  private readonly hooks: OverlayHooks;
  private mounted: 'lobby' | 'finished' | null = null;

  // lobby 节点
  private lobbyEl: HTMLDivElement | null = null;
  private lobbyRows: HTMLDivElement | null = null;
  private lobbyHint: HTMLDivElement | null = null;
  private readyBtn: HTMLButtonElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private lobbySig = '';

  // finished 节点
  private finishedEl: HTMLDivElement | null = null;
  private finishedTitle: HTMLDivElement | null = null;
  private finishedRows: HTMLDivElement | null = null;
  private finishedHint: HTMLDivElement | null = null;
  private returnBtn: HTMLButtonElement | null = null;
  private finishedSig = '';

  constructor(root: HTMLElement, hooks: OverlayHooks) {
    this.root = root;
    this.hooks = hooks;
  }

  update(state: GameState, myId: string): void {
    if (state.phase === 'lobby') {
      this.mount('finished', false);
      this.mountLobby();
      this.updateLobby(state, myId);
    } else if (state.phase === 'finished') {
      this.mount('lobby', false);
      this.mountFinished();
      this.updateFinished(state, myId);
    } else {
      this.mount('lobby', false);
      this.mount('finished', false);
    }
  }

  // -------------------------------------------------------------------------

  private mount(which: 'lobby' | 'finished', on: boolean): void {
    if (which === 'lobby' && !on && this.lobbyEl) {
      this.lobbyEl.remove();
      this.lobbyEl = null;
      this.lobbySig = '';
      this.mounted = this.mounted === 'lobby' ? null : this.mounted;
    }
    if (which === 'finished' && !on && this.finishedEl) {
      this.finishedEl.remove();
      this.finishedEl = null;
      this.finishedSig = '';
      this.mounted = this.mounted === 'finished' ? null : this.mounted;
    }
  }

  private mountLobby(): void {
    if (this.lobbyEl) return;
    this.mounted = 'lobby';
    const el = document.createElement('div');
    el.className = 'overlay';
    const panel = document.createElement('div');
    panel.className = 'panel';

    const title = document.createElement('h1');
    title.textContent = '飞镖时刻';
    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = '对旋转标靶判断提前量出手——贴镖得分，碰撞扣血，活到最后。';

    this.lobbyRows = document.createElement('div');
    this.lobbyRows.className = 'player-rows';

    this.lobbyHint = document.createElement('div');
    this.lobbyHint.className = 'hint';

    const buttons = document.createElement('div');
    buttons.className = 'button-row';
    this.readyBtn = document.createElement('button');
    this.readyBtn.type = 'button';
    this.readyBtn.className = 'btn';
    this.readyBtn.addEventListener('click', () => this.hooks.onToggleReady());
    this.startBtn = document.createElement('button');
    this.startBtn.type = 'button';
    this.startBtn.className = 'btn btn-primary';
    this.startBtn.textContent = '开始游戏';
    this.startBtn.addEventListener('click', () => this.hooks.onStartGame());
    buttons.append(this.readyBtn, this.startBtn);

    panel.append(title, sub, this.lobbyRows, this.lobbyHint, buttons);
    el.appendChild(panel);
    this.root.appendChild(el);
    this.lobbyEl = el;
  }

  private updateLobby(state: GameState, myId: string): void {
    if (!this.lobbyEl || !this.lobbyRows || !this.lobbyHint || !this.readyBtn || !this.startBtn) return;
    const players = Object.values(state.players);
    const me = state.players[myId];
    const isHost = state.hostId === myId;

    const sig = players
      .map((p) => `${p.id}:${p.name}:${p.ready}:${p.connected}:${p.isHost}:${p.status}`)
      .join('|');
    if (sig !== this.lobbySig) {
      this.lobbySig = sig;
      this.lobbyRows.replaceChildren(
        ...players
          .sort((a, b) => Number(b.isHost) - Number(a.isHost))
          .map((p) => this.playerRow(p, myId)),
      );
    }

    const readiness = lobbyReadiness(players);
    this.lobbyHint.textContent =
      players.length < 2
        ? '至少 2 人才能开局，分享房间邀请朋友吧'
        : `${readiness.readyCount}/${readiness.playerCount} 已准备`;

    this.readyBtn.textContent = me?.ready ? '取消准备' : '准备';
    this.readyBtn.classList.toggle('btn-on', !!me?.ready);
    this.readyBtn.hidden = !me || me.status !== 'waiting';

    this.startBtn.hidden = !isHost;
    this.startBtn.disabled = !readiness.canStart;
  }

  private playerRow(p: GamePlayer, myId: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'player-row';
    const dot = document.createElement('span');
    dot.className = p.ready ? 'dot dot-ready' : 'dot';
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = p.name;
    const tags = document.createElement('span');
    tags.className = 'tags';
    if (p.isHost) tags.append(this.tag('房主'));
    if (p.id === myId) tags.append(this.tag('我'));
    if (!p.connected) tags.append(this.tag('离线'));
    if (p.status === 'queued') tags.append(this.tag('候场'));
    row.append(dot, name, tags);
    return row;
  }

  private tag(text: string): HTMLSpanElement {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = text;
    return t;
  }

  // -------------------------------------------------------------------------

  private mountFinished(): void {
    if (this.finishedEl) return;
    this.mounted = 'finished';
    const el = document.createElement('div');
    el.className = 'overlay';
    const panel = document.createElement('div');
    panel.className = 'panel';

    this.finishedTitle = document.createElement('h1');
    this.finishedRows = document.createElement('div');
    this.finishedRows.className = 'player-rows';
    this.finishedHint = document.createElement('div');
    this.finishedHint.className = 'hint';
    this.returnBtn = document.createElement('button');
    this.returnBtn.type = 'button';
    this.returnBtn.className = 'btn btn-primary';
    this.returnBtn.textContent = '返回大厅';
    this.returnBtn.addEventListener('click', () => this.hooks.onReturnToLobby());

    panel.append(this.finishedTitle, this.finishedRows, this.finishedHint, this.returnBtn);
    el.appendChild(panel);
    this.root.appendChild(el);
    this.finishedEl = el;
  }

  private updateFinished(state: GameState, myId: string): void {
    if (!this.finishedTitle || !this.finishedRows || !this.finishedHint || !this.returnBtn) return;
    const ranked = rankPlayers(Object.values(state.players), state.winnerId);
    const winner = state.winnerId ? state.players[state.winnerId] : null;
    this.finishedTitle.textContent = winner
      ? winner.id === myId
        ? '🏆 你赢了！'
        : `🏆 ${winner.name} 获胜`
      : '无人生还';

    const sig = ranked
      .map((p) => `${p.id}:${p.score}:${p.stats.safeHits}:${p.status}:${p.connected}`)
      .join('|');
    if (sig !== this.finishedSig) {
      this.finishedSig = sig;
      this.finishedRows.replaceChildren(
        ...ranked.map((p, i) => {
          const row = document.createElement('div');
          row.className = 'player-row';
          const rank = document.createElement('span');
          rank.className = 'rank';
          rank.textContent = `#${i + 1}`;
          const name = document.createElement('span');
          name.className = 'player-name';
          name.textContent = p.name + (p.id === myId ? '（我）' : '');
          const score = document.createElement('span');
          score.className = 'tags';
          score.textContent = `${p.score} 分 · ${p.stats.safeHits} 安全命中${
            p.status === 'eliminated' ? ' · 淘汰' : ''
          }${p.connected ? '' : ' · 离线'}`;
          row.append(rank, name, score);
          return row;
        }),
      );
    }

    const isHost = state.hostId === myId;
    this.returnBtn.hidden = !isHost;
    this.finishedHint.textContent = isHost ? '' : '等待房主返回大厅';
  }
}
