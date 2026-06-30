import { ROOMS } from '../lib/rooms.js';

/** 大厅：列出官方示例房间，提供本地预览与 PeerJS 联机入口 (§15.2)。 */
export function Lobby() {
  return (
    <div>
      <h2>房间大厅</h2>
      <p className="meta-line">
        每个房间是一个动态加载的 Room Package（HTML + room.worker.js），运行在
        Parti Runtime 中。无需后端：UI 跑在 sandbox iframe，房间逻辑跑在 Web Worker。
      </p>
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
