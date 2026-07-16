import type { GameState } from '../game/contracts';
import { MAPS } from '../game/maps';

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);

export type MenuDispatch = (type: string, payload?: unknown) => void;

let openDropdown: 'mode' | 'map' | null = null;
let pendingReady: boolean | null = null;
let lastRenderKey = '';
let lastRenderElement: HTMLElement | null = null;

function dropdown(id: 'mode' | 'map', label: string, value: string, display: string, options: Array<{ value: string; label: string }>, disabled: boolean): string {
  return `<div class="field"><span>${label}</span><div class="dropdown ${openDropdown === id ? 'open' : ''}"><button type="button" class="dropdown-trigger" data-dropdown="${id}" ${disabled ? 'disabled' : ''}>${escapeHtml(display)}<span aria-hidden="true">▾</span></button><div class="dropdown-popup" role="listbox">${options.map((option) => `<button type="button" role="option" data-option="${id}" data-value="${option.value}" class="${option.value === value ? 'selected' : ''}">${escapeHtml(option.label)}</button>`).join('')}</div></div></div>`;
}

export function renderMenu(element: HTMLElement, state: GameState, myId: string, dispatch: MenuDispatch): void {
  if (lastRenderElement !== element) { lastRenderElement = element; lastRenderKey = ''; }
  if (state.phase === 'running') {
    const renderKey = 'running';
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey; element.innerHTML = ''; return;
  }
  const me = state.players[myId]; const isHost = state.hostId === myId;
  if (state.phase === 'finished') {
    const renderKey = JSON.stringify(['finished', state.result, state.hostId, myId]);
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;
    const winner = state.result?.draw ? '平局' : state.result?.winnerTeam ? `${state.result.winnerTeam === 'red' ? '红队' : '蓝队'}胜利` : `${escapeHtml(state.players[state.result?.winnerId ?? '']?.name ?? '未知玩家')}胜利`;
    element.innerHTML = `<h1>${winner}</h1><p>${state.result?.reason === 'timeout' ? '达到最长对局时间，按战况裁决。' : '敌方基地与坦克均已失守。'}</p>${isHost ? '<button class="primary" data-action="rematch">返回准备室并重赛</button>' : '<p class="subtle">等待房主发起下一局…</p>'}`;
    element.querySelector('[data-action="rematch"]')?.addEventListener('click', () => dispatch('game.rematch'));
    return;
  }
  if (pendingReady === me?.ready) pendingReady = null;
  const renderKey = JSON.stringify([
    'lobby', myId, state.hostId, state.config, openDropdown, pendingReady,
    Object.values(state.players).map((player) => [player.id, player.name, player.ready, player.team, player.connected]),
  ]);
  if (renderKey === lastRenderKey) return;
  lastRenderKey = renderKey;
  const playerRows = Object.values(state.players).map((player) => `<div class="player ${player.team}"><span>${escapeHtml(player.name)}${player.id === state.hostId ? ' ★' : ''}</span><span class="badge">${player.ready ? '已准备' : '未准备'}</span>${state.config.mode === 'team2v2' ? `<span class="team-buttons"><button data-team="red" data-player="${player.id}" ${player.id !== myId ? 'disabled' : ''}>红</button><button data-team="blue" data-player="${player.id}" ${player.id !== myId ? 'disabled' : ''}>蓝</button></span>` : '<span></span>'}</div>`).join('');
  const map = MAPS.find((candidate) => candidate.id === state.config.mapId) ?? MAPS[0];
  const modeMenu = dropdown('mode', '模式', state.config.mode, state.config.mode === 'freeForAll' ? '个人混战' : '2v2 团队战（需4人）', [{ value: 'freeForAll', label: '个人混战' }, { value: 'team2v2', label: '2v2 团队战（需4人）' }], !isHost);
  const mapMenu = dropdown('map', '地图', state.config.mapId, map.name, MAPS.map((candidate) => ({ value: candidate.id, label: candidate.name })), !isHost);
  element.innerHTML = `<h1>像素坦克大战</h1><p class="subtle">摧毁敌方基地，并消灭他们的最后一辆坦克。</p><div class="players">${playerRows}</div><div class="controls">${modeMenu}${mapMenu}</div><button type="button" class="primary" data-action="ready" ${pendingReady !== null ? 'disabled' : ''}>${pendingReady !== null ? '正在更新…' : me?.ready ? '取消准备' : '准备战斗'}</button>${isHost ? '<button type="button" class="primary" data-action="start">开始游戏</button>' : '<p class="subtle">全员准备后由房主开始。</p>'}`;
  element.querySelector('[data-action="ready"]')?.addEventListener('click', (event) => {
    const desired = !me?.ready; pendingReady = desired;
    const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = '正在更新…';
    dispatch('lobby.ready', { ready: desired });
  });
  element.querySelector('[data-action="start"]')?.addEventListener('click', () => dispatch('game.start'));
  element.querySelectorAll<HTMLButtonElement>('[data-team]').forEach((button) => button.addEventListener('click', () => dispatch('lobby.team', { team: button.dataset.team })));
  element.querySelectorAll<HTMLButtonElement>('[data-dropdown]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.dropdown as 'mode' | 'map'; openDropdown = openDropdown === id ? null : id;
    renderMenu(element, state, myId, dispatch);
  }));
  element.querySelectorAll<HTMLButtonElement>('[data-option]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.option; const value = button.dataset.value!; openDropdown = null;
    dispatch('lobby.configure', { mode: id === 'mode' ? value : state.config.mode, mapId: id === 'map' ? value : state.config.mapId });
  }));
}
