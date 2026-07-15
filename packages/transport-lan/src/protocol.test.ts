import { describe, expect, it } from 'vitest';
import {
  decodeLanPeerToken,
  encodeLanPeerToken,
  type LanPeerPresence,
} from './protocol';

describe('LAN peer metadata', () => {
  it('round-trips a bounded Parti room announcement', () => {
    const presence: LanPeerPresence = {
      role: 'host',
      instanceId: 'instance-1',
      hostId: 'host-1',
      roomId: 'counter',
      announcement: {
        title: 'Friday Counter',
        packageName: 'Counter',
        playerCount: 2,
        maxPlayers: 8,
        joinable: true,
        credentialRequired: false,
      },
    };

    expect(decodeLanPeerToken(encodeLanPeerToken(presence))).toEqual(presence);
  });

  it('ignores LocalSend peers, unknown versions, and malformed metadata', () => {
    expect(decodeLanPeerToken('a-native-localsend-token')).toBeNull();
    expect(decodeLanPeerToken('parti.lan.v2.eyJyb2xlIjoiaG9zdCJ9')).toBeNull();
    expect(decodeLanPeerToken('parti.lan.v1.not-base64')).toBeNull();
    expect(decodeLanPeerToken(`parti.lan.v1.${Buffer.from(JSON.stringify({
      partiVersion: '99.0.0',
      presence: { role: 'observer', instanceId: 'foreign-version' },
    })).toString('base64url')}`)).toBeNull();
    expect(decodeLanPeerToken(encodeLanPeerToken({
      role: 'client',
      instanceId: 'client-1',
      transportPeerId: 'peer-1',
      targetHostId: 'host-1',
      roomId: 'counter',
    }))).toMatchObject({ role: 'client', targetHostId: 'host-1' });
  });

  it('rejects invalid announcement values and oversized tokens', () => {
    const invalid = `parti.lan.v1.${Buffer.from(JSON.stringify({
      partiVersion: '0.1.0',
      presence: {
        role: 'host', instanceId: 'x', hostId: 'h', roomId: 'r',
        announcement: { title: '', packageName: 'P', playerCount: -1, maxPlayers: null, joinable: true, credentialRequired: false },
      },
    })).toString('base64url')}`;
    expect(decodeLanPeerToken(invalid)).toBeNull();
    expect(decodeLanPeerToken(`parti.lan.v1.${'a'.repeat(3000)}`)).toBeNull();
  });
});
