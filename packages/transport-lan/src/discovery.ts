import { DEFAULT_LAN_SIGNALING_URL, type LanRoomAnnouncement } from './protocol';
import {
  acquireLanSignalingHub,
  type LanDiscoveredRoom,
  type LanDiscoveryStatus,
} from './signaling';

export interface LanDiscoverySubscription {
  close(): void;
}

export function subscribeLanRooms(options: {
  serverUrl?: string;
  onRooms(rooms: LanDiscoveredRoom[]): void;
  onStatus?(status: LanDiscoveryStatus): void;
}): LanDiscoverySubscription {
  const lease = acquireLanSignalingHub(options.serverUrl ?? DEFAULT_LAN_SIGNALING_URL);
  const offRooms = lease.hub.subscribeRooms(options.onRooms);
  const offStatus = options.onStatus ? lease.hub.subscribeStatus(options.onStatus) : () => {};
  let closed = false;
  return {
    close: () => {
      if (closed) return;
      closed = true;
      offRooms();
      offStatus();
      lease.release();
    },
  };
}

export interface LanRoomPublication {
  update(announcement: LanRoomAnnouncement | null): void;
  close(): void;
}

export function publishLanRoom(options: {
  serverUrl?: string;
  hostId: string;
  roomId: string;
  announcement: LanRoomAnnouncement | null;
}): LanRoomPublication {
  const lease = acquireLanSignalingHub(options.serverUrl ?? DEFAULT_LAN_SIGNALING_URL);
  let announcement = options.announcement;
  let closed = false;
  const publish = () => lease.hub.setPresence({
    role: 'host',
    instanceId: lease.hub.instanceId,
    hostId: options.hostId,
    roomId: options.roomId,
    ...(announcement ? { announcement } : {}),
  });
  publish();
  return {
    update: (next) => {
      if (closed) return;
      announcement = next;
      publish();
    },
    close: () => {
      if (closed) return;
      closed = true;
      const current = lease.hub.getPresence();
      if (current.role === 'host' && current.hostId === options.hostId) {
        lease.hub.setPresence({
          role: 'host', instanceId: lease.hub.instanceId,
          hostId: options.hostId, roomId: options.roomId,
        });
      }
      lease.release();
    },
  };
}
