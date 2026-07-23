import type { RoomActionName, RoomActionPayloads, RoomEventName, RoomEventPayloads } from '../game/types';

type ActionArguments<Action extends RoomActionName> = undefined extends RoomActionPayloads[Action]
  ? [payload?: RoomActionPayloads[Action]]
  : [payload: RoomActionPayloads[Action]];

export type PartiApi = {
  playerId: string | null;
  getState(): unknown;
  onState(handler: (state: unknown) => void): () => void;
  onEvent<Event extends RoomEventName>(
    event: Event,
    handler: (payload: RoomEventPayloads[Event]) => void,
  ): () => void;
  action<Action extends RoomActionName>(
    action: Action,
    ...args: ActionArguments<Action>
  ): Promise<{ ok: true }>;
  ready(): void;
  leave(): void;
  log(...args: unknown[]): void;
  exposeToAgent?(describe: (state: unknown) => unknown): void;
};

declare global {
  const parti: PartiApi;
}
