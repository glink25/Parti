import type { RoomClientPort } from '@parti/client-sdk';

export function createRecordingPort(
  port: RoomClientPort,
  onAction: (action: string, payload: unknown) => void,
): RoomClientPort {
  return {
    ...port,
    submitAction(action, payload) {
      onAction(action, payload);
      port.submitAction(action, payload);
    },
  };
}
