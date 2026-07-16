import type { Phase } from './types';

export function drawingPermissions(phase: Phase, drawerId: string | null, playerId: string) {
  const isCurrentDrawer = drawerId === playerId;
  return { isCurrentDrawer, canDraw: phase === 'drawing' && isCurrentDrawer };
}

export function categoryDialogRole(phase: Phase, drawerId: string | null, playerId: string, relayParticipants: string[], relaySubmittedIds: string[]) {
  if (phase === 'choosing') return drawerId === playerId ? 'classic-picker' : 'classic-waiting';
  if (phase === 'relay-choosing' && relayParticipants.includes(playerId)) return relaySubmittedIds.includes(playerId) ? 'relay-waiting' : 'relay-picker';
  return 'none';
}
