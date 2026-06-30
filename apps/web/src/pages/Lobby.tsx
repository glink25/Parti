import { useState } from 'react';
import { ROOMS } from '../lib/rooms.js';
import {
  deleteCustomRoom,
  listCustomRooms,
  type CustomRoomEntry,
} from '../lib/customRooms.js';

/** 大厅：列出官方示例 + 用户自定义房间，提供本地预览 / PeerJS 联机 / 新建入口 (§15.2)。 */
export function Lobby() {
  const [custom, setCustom] = useState<CustomRoomEntry[]>(() => listCustomRooms());

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
        Parti Runtime 中。无需后端：UI 跑在 sandbox iframe，房间逻辑跑在 Web Worker；
        加入者经房主点对点取得房间代码并 packageHash 校验。
      </p>

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
