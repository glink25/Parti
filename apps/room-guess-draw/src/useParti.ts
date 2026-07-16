import { useEffect, useRef, useState } from 'react';
import type { RelayTask, RoomState } from './types';

export function useParti() {
  const [state, setState] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [privateWord, setPrivateWord] = useState<{ word: string; roundNumber: number } | null>(null);
  const [relayTasks, setRelayTasks] = useState<Record<string, RelayTask>>({});
  const [notice, setNotice] = useState('');
  const lastCanvasSummary = useRef('');
  useEffect(() => {
    const offs = [
      parti.onState((value) => {
        const next = value as RoomState;
        const summary = JSON.stringify({ phase: next.phase, canvasRevision: next.canvasRevision, strokes: next.strokes?.length ?? 0, activeStrokeId: next.activeStroke?.id ?? null, activePoints: next.activeStroke?.points.length ?? 0 });
        if (summary !== lastCanvasSummary.current) {
          lastCanvasSummary.current = summary;
          parti.log('[DRAW-SYNC]', 'state-received', { playerId: parti.playerId, ...JSON.parse(summary) });
        }
        setState(next); setPlayerId(parti.playerId);
      }),
      parti.onEvent('guess:word', (payload) => setPrivateWord({ word: String(payload?.word ?? ''), roundNumber: Number(payload?.roundNumber ?? -1) })),
      parti.onEvent('guess:notice', (payload) => setNotice(String(payload?.text ?? ''))),
      parti.onEvent('relay:task', (payload) => { const task = payload as RelayTask; if (task?.taskId) setRelayTasks((tasks) => ({ ...tasks, [task.taskId]: task })); }),
      parti.onEvent('relay:submitted', () => setNotice('已提交，等待其他玩家')),
      parti.onEvent('__error', (payload) => setNotice(String(payload?.message ?? '操作失败'))),
    ];
    parti.ready();
    return () => offs.forEach((off) => off());
  }, []);
  useEffect(() => { if (!notice) return; const id = window.setTimeout(() => setNotice(''), 2200); return () => clearTimeout(id); }, [notice]);
  useEffect(() => { if (state?.phase !== 'drawing') setPrivateWord(null); }, [state?.phase]);
  const word = state?.phase === 'drawing' && privateWord?.roundNumber === state.roundNumber ? privateWord.word : '';
  const expectedTaskId = state?.phase === 'relay-choosing' ? `choose:${state.relayStep}`
    : state?.phase === 'relay-initial-drawing' ? 'draw:0'
      : state?.phase === 'relay-guessing' ? `guess:${state.relayStep}`
        : state?.phase === 'relay-final-guess' ? `final-guess:${state.relayStep}`
          : state?.phase === 'relay-redrawing' ? `draw:${state.relayStep}` : null;
  const relayTask = expectedTaskId ? relayTasks[expectedTaskId] ?? null : null;
  return { state, playerId, word, relayTask, notice };
}
