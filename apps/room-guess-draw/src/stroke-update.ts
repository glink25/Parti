import type { Stroke } from './types';

export type StrokeUpdate = { stroke: Stroke; updateSeq: number; complete: boolean };
export type StrokeUpdateLedger = { currentId: string | null; lastSeq: number; completedIds: Set<string> };
export const STROKE_SYNC_MS = 300;

export function createStrokeId(now = Date.now(), random = Math.random()) {
  return `${now.toString(36)}-${random.toString(36).slice(2, 10)}`;
}

export function createStrokeUpdateLedger(): StrokeUpdateLedger {
  return { currentId: null, lastSeq: -1, completedIds: new Set() };
}

export function acceptStrokeUpdate(ledger: StrokeUpdateLedger, update: StrokeUpdate) {
  const { id } = update.stroke;
  if (!id || !Number.isInteger(update.updateSeq) || update.updateSeq < 0 || ledger.completedIds.has(id)) return false;
  if (ledger.currentId !== null && ledger.currentId !== id) return false;
  if (ledger.currentId === null) { ledger.currentId = id; ledger.lastSeq = -1; }
  if (update.updateSeq <= ledger.lastSeq) return false;
  ledger.lastSeq = update.updateSeq;
  if (update.complete) { ledger.completedIds.add(id); ledger.currentId = null; ledger.lastSeq = -1; }
  return true;
}

export function resetStrokeUpdateLedger(ledger: StrokeUpdateLedger) {
  ledger.currentId = null; ledger.lastSeq = -1; ledger.completedIds.clear();
}

export function shouldSendStrokeUpdate(lastSentPointCount: number, currentPointCount: number, complete: boolean) {
  return complete || currentPointCount !== lastSentPointCount;
}
