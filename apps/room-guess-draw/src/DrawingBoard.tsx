import { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Line, Stage } from 'react-konva';
import { canvasPointCount, MAX_POINTS_PER_CANVAS, MAX_POINTS_PER_STROKE, MAX_STROKES_PER_CANVAS } from './canvas-budget';
import { canvasScale, fitCanvas, normalizedCanvasPoint } from './canvas-geometry';
import { COLORS, SIZES } from './drawing';
import { createStrokeId, shouldSendStrokeUpdate, STROKE_SYNC_MS } from './stroke-update';
import type { Point, Stroke, Tool } from './types';

type Props = { strokes: Stroke[]; sessionKey: string; canvasRevision: number; taskId?: string; editable: boolean; canSubmit?: boolean; onSubmit?: () => void };
type LocalStroke = Stroke & { updateSeq: number; lastSentPointCount: number; timer: number | null; maxPoints: number };

function projectedPoints(stroke: Stroke, width: number, height: number) { return stroke.points.flatMap((point) => [point.x * width, point.y * height]); }
function StrokeLine({ stroke, width, height }: { stroke: Stroke; width: number; height: number }) { const points = projectedPoints(stroke, width, height); if (points.length === 2) points.push(points[0] + .01, points[1] + .01); const scale = canvasScale(width); const logicalWidth = stroke.tool === 'eraser' ? Math.max(20, stroke.size * 2.4) : stroke.size; return <Line points={points} stroke={stroke.color} strokeWidth={logicalWidth * scale} lineCap="round" lineJoin="round" tension={.25} globalCompositeOperation={stroke.tool === 'eraser' ? 'destination-out' : 'source-over'} listening={false} perfectDrawEnabled={false} />; }

export function DrawingBoard({ strokes, sessionKey, canvasRevision, taskId, editable, canSubmit, onSubmit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null); const stageHostRef = useRef<HTMLDivElement>(null); const localRef = useRef<LocalStroke | null>(null);
  const [sizePx, setSizePx] = useState({ width: 1, height: 1 }); const [tool, setTool] = useState<Tool>('pen'); const [color, setColor] = useState<string>(COLORS[0]); const [brushSize, setBrushSize] = useState<number>(8);
  const [localActive, setLocalActive] = useState<Stroke | null>(null); const [optimistic, setOptimistic] = useState<Stroke[]>([]);
  const completedIds = useMemo(() => new Set(strokes.map((stroke) => stroke.id)), [strokes]);
  const pointCount = canvasPointCount(strokes) + canvasPointCount(optimistic) + (localActive?.points.length ?? 0);
  const nearLimit = strokes.length + optimistic.length >= 240 || pointCount >= 19_200;
  const atLimit = strokes.length + optimistic.length >= MAX_STROKES_PER_CANVAS || pointCount >= MAX_POINTS_PER_CANVAS;
  const canvasRect = fitCanvas(sizePx.width, sizePx.height);

  useEffect(() => { const host = hostRef.current; if (!host) return; const resize = () => setSizePx({ width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) }); const observer = new ResizeObserver(resize); observer.observe(host); resize(); return () => observer.disconnect(); }, []);
  useEffect(() => {
    parti.log('[DRAW-SYNC]', 'board-state', {
      sessionKey, editable, canvasRevision, taskId: taskId ?? null,
      completedStrokes: strokes.length,
      completedPoints: canvasPointCount(strokes),
      width: canvasRect.width, height: canvasRect.height,
    });
  }, [sessionKey, editable, canvasRevision, taskId, strokes, canvasRect.width, canvasRect.height]);
  useEffect(() => { const active = localRef.current; if (active?.timer != null) clearTimeout(active.timer); localRef.current = null; setLocalActive(null); setOptimistic([]); }, [sessionKey]);
  useEffect(() => setOptimistic((items) => items.filter((stroke) => !completedIds.has(stroke.id))), [completedIds]);

  function payloadStroke(active: LocalStroke): Stroke { return { id: active.id, tool: active.tool, color: active.color, size: active.size, points: [...active.points] }; }
  function send(active: LocalStroke, complete: boolean) { if (!shouldSendStrokeUpdate(active.lastSentPointCount, active.points.length, complete)) return; const updateSeq = active.updateSeq++; parti.log('[DRAW-SYNC]', 'client-send', { strokeId: active.id, updateSeq, pointCount: active.points.length, canvasRevision, taskId: taskId ?? null, complete }); void parti.action('submitStroke', { canvasRevision, taskId, updateSeq, complete, stroke: payloadStroke(active) }); active.lastSentPointCount = active.points.length; }
  function schedule(active: LocalStroke) { active.timer = window.setTimeout(() => { if (localRef.current !== active) return; active.timer = null; parti.log('[DRAW-SYNC]', 'client-timer', { strokeId: active.id, pointCount: active.points.length, canvasRevision }); send(active, false); schedule(active); }, STROKE_SYNC_MS); }
  function normalized(clientX: number, clientY: number): Point { return normalizedCanvasPoint(clientX, clientY, stageHostRef.current!.getBoundingClientRect()); }
  function start(event: any) { if (!editable || event.evt.button > 0 || localRef.current || atLimit) return; event.evt.currentTarget?.setPointerCapture?.(event.evt.pointerId); const point = normalized(event.evt.clientX, event.evt.clientY); const active: LocalStroke = { id: createStrokeId(), tool, color, size: brushSize, points: [point], updateSeq: 0, lastSentPointCount: 0, timer: null, maxPoints: Math.min(MAX_POINTS_PER_STROKE, MAX_POINTS_PER_CANVAS - pointCount) }; parti.log('[DRAW-SYNC]', 'client-start', { strokeId: active.id, pointCount: 1, canvasRevision, taskId: taskId ?? null }); localRef.current = active; setLocalActive(payloadStroke(active)); schedule(active); }
  function move(event: any) { const active = localRef.current; if (!active || !editable) return; const nativeEvents = typeof event.evt.getCoalescedEvents === 'function' ? event.evt.getCoalescedEvents() : [event.evt]; for (const native of nativeEvents) { const point = normalized(native.clientX, native.clientY); const last = active.points.at(-1)!; if (Math.hypot((point.x - last.x) * canvasRect.width, (point.y - last.y) * canvasRect.height) < 1.5) continue; if (active.points.length >= active.maxPoints) break; active.points.push(point); } setLocalActive(payloadStroke(active)); }
  function finish(event?: any) { const active = localRef.current; if (!active) return; event?.evt?.currentTarget?.releasePointerCapture?.(event.evt.pointerId); if (active.timer !== null) clearTimeout(active.timer); parti.log('[DRAW-SYNC]', 'client-finish', { strokeId: active.id, pointCount: active.points.length, canvasRevision, taskId: taskId ?? null }); send(active, true); setOptimistic((items) => [...items, payloadStroke(active)]); setLocalActive(null); localRef.current = null; }
  function clear() { const active = localRef.current; if (active?.timer != null) clearTimeout(active.timer); localRef.current = null; setLocalActive(null); setOptimistic([]); void parti.action('clearCanvas', { canvasRevision, taskId }); }
  const visible = [...strokes, ...optimistic.filter((stroke) => !completedIds.has(stroke.id)), ...(localActive ? [localActive] : [])];
  return <section className="board-card"><div className="canvas-wrap" ref={hostRef}><div className="canvas-stage" ref={stageHostRef} style={{ left: canvasRect.left, top: canvasRect.top, width: canvasRect.width, height: canvasRect.height }}><Stage width={canvasRect.width} height={canvasRect.height} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}><Layer>{visible.map((stroke) => <StrokeLine key={`${stroke.id}-${stroke === localActive ? stroke.points.length : ''}`} stroke={stroke} width={canvasRect.width} height={canvasRect.height} />)}</Layer></Stage></div></div>{editable && <div className="tools"><button title="画笔" className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')}>✎</button><button title="橡皮" className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')}>⌫</button>{COLORS.map((item) => <button key={item} aria-label={item} className={`color ${color === item ? 'active' : ''}`} style={{ background: item }} onClick={() => { setColor(item); setTool('pen'); }} />)}{SIZES.map((item) => <button key={item} className={brushSize === item ? 'active' : ''} onClick={() => setBrushSize(item)}><i style={{ width: Math.max(4, item / 2), height: Math.max(4, item / 2) }} /></button>)}<button className="danger" onClick={clear}>清空</button>{nearLimit && <span className="canvas-budget">{atLimit ? '画布已满' : '空间即将用完'}</span>}{canSubmit && <button className="primary" onClick={onSubmit}>完成</button>}</div>}</section>;
}
