import { useState } from 'react';
import { createPackage, type RoomPackageInput } from '@parti/room-packager';
import { saveCustomRoom } from '../lib/customRooms.js';

/**
 * 最简创作入口 (GOAL §4.1, §11.3)：粘贴三件套文本（可选上传额外文件）即可建包。
 * 保存时校验 manifest + 计算 packageHash（createPackage），存入 localStorage，
 * 随后即可本地预览或开 PeerJS 房间——加入者会经 host 点对点取到同一份代码。
 */

const DEFAULT_MANIFEST = `{
  "partiVersion": "0.1.0",
  "protocolVersion": 1,
  "id": "my-room",
  "name": "我的房间",
  "version": "0.1.0",
  "description": "一个自定义多人房间",
  "entry": {
    "ui": "index.html",
    "worker": "room.worker.js"
  },
  "room": { "minPlayers": 1, "maxPlayers": 8 },
  "sync": { "mode": "snapshot" },
  "permissions": { "network": false, "storage": "session" }
}
`;

const DEFAULT_HTML = `<div style="font-family: system-ui, sans-serif; padding: 16px; color: #111;">
  <h1 style="font-size: 20px;">我的房间</h1>
  <div id="count" style="font-size: 40px; font-weight: 700;">0</div>
  <button id="inc" style="font-size: 16px; padding: 8px 16px;">+1</button>

  <script>
    const countEl = document.getElementById('count');
    parti.onState((s) => { countEl.textContent = String(s.count); });
    document.getElementById('inc').onclick = () => parti.action('increment');
    parti.ready();
  </script>
</div>
`;

const DEFAULT_WORKER = `import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  initialState() {
    return { count: 0 };
  },
  actions: {
    increment(ctx, { player }) {
      ctx.state.count += 1;
      ctx.broadcast('counter:incremented', { count: ctx.state.count });
    },
  },
});
`;

export function EditorView() {
  const [manifestText, setManifestText] = useState(DEFAULT_MANIFEST);
  const [htmlText, setHtmlText] = useState(DEFAULT_HTML);
  const [workerText, setWorkerText] = useState(DEFAULT_WORKER);
  /** 额外上传的文件（相对路径 -> 文本），如 style.css / 资源。 */
  const [extraFiles, setExtraFiles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function build(): Promise<string | null> {
    setError(null);
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      setError('parti.room.json 不是合法 JSON');
      return null;
    }
    const m = manifest as { entry?: { ui?: string; worker?: string } };
    const uiName = m.entry?.ui ?? 'index.html';
    const workerName = m.entry?.worker ?? 'room.worker.js';
    const files: Record<string, string> = {
      ...extraFiles,
      [uiName]: htmlText,
      [workerName]: workerText,
    };
    const input: RoomPackageInput = { manifest, files };
    try {
      // 校验 manifest + 计算 packageHash；任何错误在此暴露。
      await createPackage(input);
      return saveCustomRoom(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function onSave(target: 'local' | 'peer'): Promise<void> {
    setBusy(true);
    try {
      const id = await build();
      if (!id) return;
      window.location.hash =
        target === 'local' ? `#/local/${id}` : `#/peer/host/${id}`;
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const list = e.target.files;
    if (!list) return;
    const next: Record<string, string> = {};
    for (const file of Array.from(list)) {
      next[file.name] = await file.text();
    }
    setExtraFiles((prev) => ({ ...prev, ...next }));
    e.target.value = '';
  }

  return (
    <div>
      <h2>
        新建房间{' '}
        <a className="meta-line" href="#/" style={{ fontSize: 13 }}>
          ← 返回大厅
        </a>
      </h2>
      <p className="meta-line">
        粘贴/编辑三件套即可建包：<code>parti.room.json</code> +{' '}
        <code>index.html</code> + <code>room.worker.js</code>。可选上传额外文件
        （样式/资源）。保存后加入者会经房主点对点取到同一份代码并 packageHash 校验。
      </p>

      {error && <div className="card error">出错：{error}</div>}

      <div className="card">
        <label className="editor-field">
          <b>parti.room.json</b>
          <textarea
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
            rows={12}
            spellCheck={false}
          />
        </label>
      </div>

      <div className="card">
        <label className="editor-field">
          <b>index.html</b>
          <textarea
            value={htmlText}
            onChange={(e) => setHtmlText(e.target.value)}
            rows={14}
            spellCheck={false}
          />
        </label>
      </div>

      <div className="card">
        <label className="editor-field">
          <b>room.worker.js</b>
          <textarea
            value={workerText}
            onChange={(e) => setWorkerText(e.target.value)}
            rows={14}
            spellCheck={false}
          />
        </label>
      </div>

      <div className="card">
        <b>额外文件（可选）</b>
        <p className="meta-line">
          上传样式/资源等，会以文件名为相对路径并入房间包。
        </p>
        <input type="file" multiple onChange={onUpload} />
        {Object.keys(extraFiles).length > 0 && (
          <ul style={{ fontSize: 13, marginTop: 8 }}>
            {Object.keys(extraFiles).map((name) => (
              <li key={name}>
                {name}{' '}
                <button
                  className="btn secondary"
                  onClick={() =>
                    setExtraFiles((prev) => {
                      const next = { ...prev };
                      delete next[name];
                      return next;
                    })
                  }
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="room-actions">
        <button className="btn" disabled={busy} onClick={() => onSave('local')}>
          保存并本地预览
        </button>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => onSave('peer')}
        >
          保存并开 PeerJS 房间
        </button>
      </div>
    </div>
  );
}
