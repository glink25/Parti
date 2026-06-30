import { useEffect, useState } from 'react';
import { ROOMS } from '../lib/rooms.js';
import {
  deleteCustomRoom,
  listCustomRooms,
  type CustomRoomEntry,
} from '../lib/customRooms.js';
import {
  LobbyClient,
  lobbyServiceUrl,
  type LobbyRoom,
} from '../lib/lobbyApi.js';

/** 大厅：列出官方示例 + 用户自定义房间，提供本地预览 / PeerJS 联机 / 新建入口 (§15.2)。 */
export function Lobby() {
  const [custom, setCustom] = useState<CustomRoomEntry[]>(() => listCustomRooms());
  const [online, setOnline] = useState<LobbyRoom[]>([]);
  const [onlineStatus, setOnlineStatus] = useState('');

  useEffect(() => {
    const baseUrl = lobbyServiceUrl();
    if (!baseUrl) {
      setOnlineStatus('未配置大厅服务，仍可创建私密房间并通过链接邀请。');
      return;
    }
    const client = new LobbyClient(baseUrl);
    const refresh = () => {
      client
        .listRooms()
        .then((rooms) => {
          setOnline(rooms);
          setOnlineStatus('');
        })
        .catch(() => setOnlineStatus('大厅服务暂时不可用，稍后会自动重试。'));
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, []);

  function onDelete(id: string): void {
    deleteCustomRoom(id);
    setCustom(listCustomRooms());
  }

  return (
    <div>
      <div className="lobby-head">
        <h2>房间大厅</h2>
        <a className="btn" href="#/editor">
          + 新建房间
        </a>
      </div>
      <p className="meta-line">
        每个房间是一个动态加载的 Room Package（HTML + room.worker.js），运行在
        Parti Runtime 中。房间逻辑仍由房主浏览器运行；大厅服务只保存在线目录与租约，
        加入者经房主点对点取得房间代码并完成准入校验。
      </p>

      <h3 className="meta-line section-title">在线房间</h3>
      {onlineStatus && <p className="meta-line">{onlineStatus}</p>}
      {online.length === 0 && !onlineStatus && <p className="meta-line">当前没有公开房间。</p>}
      {online.length > 0 && (
        <div className="room-list online-rooms">
          {online.map((room) => (
            <div className="card room-card" key={room.listingId}>
              <div className="room-title-line">
                <h3>{room.title}</h3>
                {room.credentialRequired && <span className="badge">需密码</span>}
              </div>
              <p>{room.packageName}</p>
              <p>
                {room.playerCount}{room.maxPlayers === null ? ' 人在线' : ` / ${room.maxPlayers} 人`}
                {' · '}{room.joinable ? '可加入' : '已满'}
              </p>
              <div className="room-actions">
                <a
                  className={`btn${room.joinable ? '' : ' disabled'}`}
                  href={room.joinable ? `#/peer/join/${encodeURIComponent(room.roomId)}/${encodeURIComponent(room.hostPeerId)}` : undefined}
                  aria-disabled={!room.joinable}
                >
                  加入房间
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {custom.length > 0 && (
        <>
          <h3 className="meta-line">我的房间</h3>
          <div className="room-list">
            {custom.map((room) => (
              <div className="card room-card" key={room.id}>
                <h3>{room.name}</h3>
                <p>{room.description}</p>
                <div className="room-actions">
                  <a className="btn" href={`#/local/${room.id}`}>
                    本地预览 (Host+2 玩家)
                  </a>
                  <a className="btn secondary" href={`#/peer/host/${room.id}`}>
                    PeerJS 联机
                  </a>
                  <button className="btn secondary" onClick={() => onDelete(room.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="meta-line">官方示例</h3>
      <div className="room-list">
        {ROOMS.map((room) => (
          <div className="card room-card" key={room.id}>
            <h3>{room.name}</h3>
            <p>{room.description}</p>
            <div className="room-actions">
              <a className="btn" href={`#/local/${room.id}`}>
                本地预览 (Host+2 玩家)
              </a>
              <a className="btn secondary" href={`#/peer/host/${room.id}`}>
                PeerJS 联机
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
