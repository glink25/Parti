import type { Direction } from '../game/contracts';

export interface TouchControlState { direction: Direction; firing: boolean }

export function createTouchControls(): { setEnabled(enabled: boolean): void; readTouchControls(): TouchControlState } {
  const root = document.createElement('div');
  root.className = 'touch-controls';
  root.innerHTML = `<div class="touch-stick" aria-label="移动摇杆"><div class="touch-stick-knob"></div></div><button type="button" class="touch-fire" aria-label="射击">FIRE</button>`;
  document.body.appendChild(root);
  const stick = root.querySelector<HTMLElement>('.touch-stick')!;
  const knob = root.querySelector<HTMLElement>('.touch-stick-knob')!;
  const fire = root.querySelector<HTMLButtonElement>('.touch-fire')!;
  let direction: Direction = 'none';
  let firing = false;
  let stickPointer: number | null = null;

  const updateStick = (event: PointerEvent) => {
    const rect = stick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const radius = rect.width * .28;
    const length = Math.hypot(dx, dy) || 1;
    const scale = Math.min(1, radius / length);
    knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < rect.width * .1) direction = 'none';
    else direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  };
  const releaseStick = (event: PointerEvent) => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = null; direction = 'none'; knob.style.transform = 'translate(0, 0)';
  };
  stick.addEventListener('pointerdown', (event) => {
    event.preventDefault(); stickPointer = event.pointerId; stick.setPointerCapture(event.pointerId); updateStick(event);
  });
  stick.addEventListener('pointermove', (event) => { if (event.pointerId === stickPointer) updateStick(event); });
  stick.addEventListener('pointerup', releaseStick);
  stick.addEventListener('pointercancel', releaseStick);
  fire.addEventListener('pointerdown', (event) => { event.preventDefault(); fire.setPointerCapture(event.pointerId); firing = true; fire.classList.add('pressed'); });
  const releaseFire = () => { firing = false; fire.classList.remove('pressed'); };
  fire.addEventListener('pointerup', releaseFire);
  fire.addEventListener('pointercancel', releaseFire);
  fire.addEventListener('lostpointercapture', releaseFire);

  return {
    setEnabled(enabled) {
      root.classList.toggle('enabled', enabled);
      if (!enabled) { direction = 'none'; firing = false; knob.style.transform = 'translate(0, 0)'; }
    },
    readTouchControls: () => ({ direction, firing }),
  };
}
