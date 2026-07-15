import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { cn } from '@/lib/utils';

export type CornerSnapCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

type Insets = { top: number; right: number; bottom: number; left: number };
type Point = { x: number; y: number };
type Range = { minX: number; maxX: number; minY: number; maxY: number };

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 32, mass: 0.8 };
const DRAG_CLICK_THRESHOLD_PX = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Suppress only the next trailing click after a real drag (self-removing). */
function suppressNextClick(cleanupRef: { current: (() => void) | null }) {
  cleanupRef.current?.();

  const suppress = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    clear();
  };

  let timer = 0;
  const clear = () => {
    window.clearTimeout(timer);
    document.removeEventListener('click', suppress, true);
    if (cleanupRef.current === clear) cleanupRef.current = null;
  };

  document.addEventListener('click', suppress, true);
  timer = window.setTimeout(clear, 300);
  cleanupRef.current = clear;
}

function readSafeAreaInsets(): Insets {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

function measureLayout(
  boundsEl: HTMLElement,
  itemEl: HTMLElement,
  margin: number,
): { corners: Record<CornerSnapCorner, Point>; range: Range } | null {
  const bounds = boundsEl.getBoundingClientRect();
  const size = itemEl.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || size.width <= 0 || size.height <= 0) return null;

  const safe = readSafeAreaInsets();
  const minX = margin + safe.left;
  const minY = margin + safe.top;
  const maxX = Math.max(minX, bounds.width - size.width - margin - safe.right);
  const maxY = Math.max(minY, bounds.height - size.height - margin - safe.bottom);

  return {
    range: { minX, maxX, minY, maxY },
    corners: {
      'top-left': { x: minX, y: minY },
      'top-right': { x: maxX, y: minY },
      'bottom-left': { x: minX, y: maxY },
      'bottom-right': { x: maxX, y: maxY },
    },
  };
}

function nearestCorner(point: Point, corners: Record<CornerSnapCorner, Point>): CornerSnapCorner {
  let best: CornerSnapCorner = 'top-right';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [name, corner] of Object.entries(corners) as [CornerSnapCorner, Point][]) {
    const dist = (point.x - corner.x) ** 2 + (point.y - corner.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

export function CornerSnapShell({
  children,
  defaultCorner = 'top-right',
  margin = 16,
  className,
}: {
  children: ReactNode;
  defaultCorner?: CornerSnapCorner;
  margin?: number;
  className?: string;
}) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<CornerSnapCorner>(defaultCorner);
  const draggingRef = useRef(false);
  const didDragRef = useRef(false);
  const armedSuppressRef = useRef(false);
  const clickSuppressCleanupRef = useRef<(() => void) | null>(null);
  const pointerOriginRef = useRef({ clientX: 0, clientY: 0, originX: 0, originY: 0 });
  const rangeRef = useRef<Range>({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  const activePointerIdRef = useRef<number | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [ready, setReady] = useState(false);

  useEffect(() => () => clickSuppressCleanupRef.current?.(), []);

  const placeAtCorner = useCallback(
    (corner: CornerSnapCorner, animateTo: boolean) => {
      if (draggingRef.current) return;
      const boundsEl = boundsRef.current;
      const itemEl = itemRef.current;
      if (!boundsEl || !itemEl) return;

      const layout = measureLayout(boundsEl, itemEl, margin);
      if (!layout) return;

      const target = layout.corners[corner];
      cornerRef.current = corner;

      if (animateTo) {
        void animate(x, target.x, SPRING);
        void animate(y, target.y, SPRING);
      } else {
        x.set(target.x);
        y.set(target.y);
      }
      setReady(true);
    },
    [margin, x, y],
  );

  useLayoutEffect(() => {
    placeAtCorner(cornerRef.current, false);
  }, [placeAtCorner]);

  useEffect(() => {
    const boundsEl = boundsRef.current;
    if (!boundsEl) return;

    const observer = new ResizeObserver(() => {
      placeAtCorner(cornerRef.current, false);
    });
    observer.observe(boundsEl);
    if (itemRef.current) observer.observe(itemRef.current);

    const onResize = () => placeAtCorner(cornerRef.current, false);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [placeAtCorner]);

  const detachPointerListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => () => detachPointerListenersRef.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const boundsEl = boundsRef.current;
    const itemEl = itemRef.current;
    if (!boundsEl || !itemEl) return;

    const layout = measureLayout(boundsEl, itemEl, margin);
    if (!layout) return;

    // Do NOT setPointerCapture here — that steals the click from child buttons.
    // Track on document until movement exceeds the drag threshold, then capture.
    x.stop();
    y.stop();

    draggingRef.current = true;
    didDragRef.current = false;
    armedSuppressRef.current = false;
    activePointerIdRef.current = event.pointerId;
    rangeRef.current = layout.range;
    pointerOriginRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      originX: x.get(),
      originY: y.get(),
    };

    const pointerId = event.pointerId;

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || !draggingRef.current) return;

      const { clientX, clientY, originX, originY } = pointerOriginRef.current;
      const dx = moveEvent.clientX - clientX;
      const dy = moveEvent.clientY - clientY;

      if (!didDragRef.current) {
        if (Math.hypot(dx, dy) <= DRAG_CLICK_THRESHOLD_PX) return;
        didDragRef.current = true;
        if (!armedSuppressRef.current) {
          armedSuppressRef.current = true;
          suppressNextClick(clickSuppressCleanupRef);
        }
        try {
          itemEl.setPointerCapture(pointerId);
        } catch {
          // Pointer may already be up; ignore.
        }
      }

      const { minX, maxX, minY, maxY } = rangeRef.current;
      x.set(clamp(originX + dx, minX, maxX));
      y.set(clamp(originY + dy, minY, maxY));
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      detach();

      if (!draggingRef.current) return;
      draggingRef.current = false;
      activePointerIdRef.current = null;
      armedSuppressRef.current = false;

      if (itemEl.hasPointerCapture(pointerId)) {
        itemEl.releasePointerCapture(pointerId);
      }

      // Pure click: leave position alone so the child's click can fire.
      if (!didDragRef.current) return;

      const latest = measureLayout(boundsEl, itemEl, margin);
      if (!latest) return;
      const next = nearestCorner({ x: x.get(), y: y.get() }, latest.corners);
      placeAtCorner(next, true);
    };

    const detach = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (detachPointerListenersRef.current === detach) {
        detachPointerListenersRef.current = null;
      }
    };

    detachPointerListenersRef.current?.();
    detachPointerListenersRef.current = detach;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      ref={boundsRef}
      className={cn('pointer-events-none absolute inset-0 z-10', className)}
    >
      <motion.div
        ref={itemRef}
        onPointerDown={onPointerDown}
        style={{ x, y, opacity: ready ? 1 : 0 }}
        className="pointer-events-auto absolute top-0 left-0 touch-none select-none"
      >
        {children}
      </motion.div>
    </div>
  );
}
