const PORTAL_CONTENT_SELECTORS = [
  '[data-slot="select-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
] as const;

let selectWasOpenOnPointerDown = false;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    () => {
      selectWasOpenOnPointerDown = Boolean(
        document.querySelector('[data-slot="select-content"][data-state="open"]'),
      );
    },
    true,
  );
}

function isPortaledContentTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return PORTAL_CONTENT_SELECTORS.some((selector) => target.closest(selector));
}

export function preventDismissOnPortaledPointerDownOutside(event: { preventDefault(): void; detail: { originalEvent: Event } }): void {
  const target = event.detail.originalEvent.target;

  if (isPortaledContentTarget(target)) {
    event.preventDefault();
    return;
  }

  if (selectWasOpenOnPointerDown) {
    event.preventDefault();
    selectWasOpenOnPointerDown = false;
  }
}
