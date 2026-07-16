import {
  engineInit, gamepadIsDown, gamepadStick, keyIsDown, setCanvasFixedSize, setInputPreventDefault, vec2,
} from 'littlejsengine';
import { createGameRuntime, createPartiSyncPlugin, type GameRuntime } from '@parti/flow';
import { tankBattleDefinition } from './game/definition';
import { PLAYER_SPEED, type Direction, type GameState } from './game/contracts';
import { canOccupy } from './game/rules';
import { configureCamera, prepareWorld, renderActors, renderHud, sounds, updateCamera } from './client/render';
import { renderMenu } from './client/menu';
import { createTouchControls } from './client/touch-controls';
import './styles.css';

const menu = document.querySelector<HTMLElement>('#menu')!;
const gameRoot = document.querySelector<HTMLElement>('#game-root')!;
let state: GameState | null = null;
let game: GameRuntime | null = null;
let lastInput: Direction = 'none';
let lastInputAt = 0;
let fireHeld = false;
let previousBullets = 0;
let previousPowerUps = 0;
let lastFireAt = 0;
let predicted: { x: number; y: number } | undefined;
const touchControls = createTouchControls();

function currentDirection(): Direction {
  const touch = touchControls.readTouchControls();
  if (touch.direction !== 'none') return touch.direction;
  const stick = gamepadStick(0);
  const x = (keyIsDown('ArrowLeft') || keyIsDown('KeyA') ? -1 : 0) + (keyIsDown('ArrowRight') || keyIsDown('KeyD') ? 1 : 0) + stick.x;
  const y = (keyIsDown('ArrowUp') || keyIsDown('KeyW') ? -1 : 0) + (keyIsDown('ArrowDown') || keyIsDown('KeyS') ? 1 : 0) - stick.y;
  if (Math.max(Math.abs(x), Math.abs(y)) < .28) return 'none';
  return Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down');
}

function updateInput(): void {
  if (!state || state.phase !== 'running' || !game) return;
  const now = performance.now(); const direction = currentDirection();
  if (direction !== lastInput || now - lastInputAt >= 80) { game.action('player.input', { direction }); lastInput = direction; lastInputAt = now; }
  const authoritative = parti.playerId ? state.players[parti.playerId] : undefined;
  if (authoritative?.alive) {
    predicted ??= { x: authoritative.x, y: authoritative.y };
    predicted.x += (authoritative.x - predicted.x) * .12;
    predicted.y += (authoritative.y - predicted.y) * .12;
    const delta = direction === 'left' ? { x: -1, y: 0 } : direction === 'right' ? { x: 1, y: 0 } : direction === 'up' ? { x: 0, y: -1 } : direction === 'down' ? { x: 0, y: 1 } : { x: 0, y: 0 };
    const nx = predicted.x + delta.x * PLAYER_SPEED / 60; const ny = predicted.y + delta.y * PLAYER_SPEED / 60;
    if (canOccupy(state, nx, ny)) { predicted.x = nx; predicted.y = ny; }
  } else predicted = undefined;
  const firing = keyIsDown('Space') || keyIsDown('Enter') || gamepadIsDown(0) || touchControls.readTouchControls().firing;
  if (firing && (!fireHeld || now - lastFireAt >= 220)) { game.action('player.fire'); sounds.fire.play(undefined, .45); lastFireAt = now; }
  fireHeld = firing;
}

function observeEffects(next: GameState): void {
  const bulletCount = Object.keys(next.bullets).length; const powerUpCount = Object.keys(next.powerUps).length;
  if (bulletCount < previousBullets) sounds.explosion.play(undefined, .35);
  if (powerUpCount < previousPowerUps) sounds.pickup.play(undefined, .45);
  previousBullets = bulletCount; previousPowerUps = powerUpCount;
}

parti.onState((snapshot) => {
  const next = snapshot as GameState; observeEffects(next); state = next;
  const playerId = parti.playerId;
  if (playerId && !game) { game = createGameRuntime(tankBattleDefinition, { role: 'client', playerId }); game.use(createPartiSyncPlugin(parti)); }
  if (playerId && game) renderMenu(menu, next, playerId, (type, payload) => { game?.action(type, payload); });
  setInputPreventDefault(next.phase === 'running');
  touchControls.setEnabled(next.phase === 'running');
});

setCanvasFixedSize(vec2(960, 720));
await engineInit(
  () => { configureCamera(); },
  () => { updateInput(); updateCamera(state, parti.playerId, predicted); game?.update(1 / 60); },
  () => {},
  () => prepareWorld(state),
  () => { renderActors(state, parti.playerId, predicted); renderHud(state, parti.playerId); },
  [], gameRoot,
);

parti.ready();
