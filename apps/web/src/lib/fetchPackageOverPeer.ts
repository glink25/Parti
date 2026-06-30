/**
 * joiner 端取包 —— 经 Host 点对点下载房间代码包 (GOAL §11.1, §8.5)。
 *
 * MVP 无后端：加入自定义房间的玩家无法 fetch 静态 URL，改为连上 host 后通过
 * 现有 PeerJS 通道请求房间文件，再用 packageHash 做**内容寻址校验**——
 * 加入者信任自己重算出的 hash，而非 host 自述。
 *
 * 用一次性临时连接取包；随后 ReconnectingClient 照旧开自己的连接做 hello。
 * 重连不需要重新取包（pkg 已被 join 流程持有）。
 */
import {
  PARTI_VERSION,
  SeqCounter,
  createMessage,
  type ClientTransportSession,
  type PackageDataPayload,
  type RoomMessage,
} from '@parti/core';
import { PeerJSTransportAdapter } from '@parti/transport-peerjs';
import { createPackage, type RoomPackage } from '@parti/room-packager';

const PACKAGE_FETCH_TIMEOUT_MS = 15_000;

export async function fetchPackageOverPeer(
  roomId: string,
  hostPeerId: string,
): Promise<RoomPackage> {
  const adapter = new PeerJSTransportAdapter();
  const transport = await adapter.joinRoom({
    roomId,
    hostConnectionInfo: hostPeerId,
  });

  try {
    const data = await requestPackageData(transport, roomId);
    // 重算并校验 packageHash（内容寻址：host 谎报文件会被 hash 比对拒绝）。
    return await createPackage({ manifest: data.manifest, files: data.files });
  } finally {
    transport.close();
  }
}

function requestPackageData(
  transport: ClientTransportSession,
  roomId: string,
): Promise<PackageDataPayload> {
  return new Promise<PackageDataPayload>((resolve, reject) => {
    const seq = new SeqCounter();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error('取房间代码包超时（房主可能不在线，或使用了不支持取包的旧版本）'),
      );
    }, PACKAGE_FETCH_TIMEOUT_MS);

    transport.onMessage((tm) => {
      const message = tm.data as RoomMessage;
      if (message.type !== 'sys:package-data' || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(message.payload as PackageDataPayload);
    });

    transport.onDisconnect((reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(reason ?? '与房主的连接已断开，未能取得房间代码包'));
    });

    const request: RoomMessage = createMessage({
      roomId,
      from: transport.selfId,
      to: transport.hostId,
      seq: seq.next(),
      channel: 'sys',
      type: 'sys:package-request',
      payload: { partiVersion: PARTI_VERSION },
    });
    transport.send({ data: request, meta: { reliable: true, ordered: true } });
  });
}
