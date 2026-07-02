import { describe, expect, it, vi } from 'vitest';
import type { RoomClientPort } from '@parti/client-sdk';
import { createRecordingPort } from './recordingPort';

describe('createRecordingPort', () => {
  it('observes and forwards a host action exactly once', () => {
    const submitAction = vi.fn();
    const onAction = vi.fn();
    const port: RoomClientPort = {
      isReady: () => true,
      onReady: () => () => {},
      getPlayerId: () => 'host',
      getState: () => ({}),
      submitAction,
      ready: () => {},
      leave: () => {},
      onState: () => () => {},
      onEvent: () => () => {},
    };

    createRecordingPort(port, onAction).submitAction('increment', { amount: 1 });

    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith('increment', { amount: 1 });
    expect(submitAction).toHaveBeenCalledOnce();
    expect(submitAction).toHaveBeenCalledWith('increment', { amount: 1 });
  });
});
