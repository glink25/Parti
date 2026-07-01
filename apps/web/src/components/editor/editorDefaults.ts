import { createDraftId } from '@/lib/ids.js';
import type { TemplateListEntry } from '@/lib/rooms.js';

export type EditorFile = 'manifest' | 'html' | 'worker';
export type BlankChoice = { id: 'blank'; name: string; description: string };
export type SelectableTemplate = BlankChoice | TemplateListEntry;

export const BLANK_TEMPLATE: BlankChoice = { id: 'blank', name: '空白房间', description: '从简洁的互动计数器开始，自由改造成你的玩法。' };

export const AI_ROOM_PROMPT = `请帮我创建一个可以直接导入 Parti 的多人联机游戏房间。

开始设计和编写代码前，请先阅读并理解以下 GitHub docs 目录中的全部文档：
https://github.com/glink25/Parti/tree/main/docs

请严格遵守文档中关于 Manifest、客户端 API、Worker API、协议和 Host Runtime 的约束，尤其注意房间状态必须由 Worker 权威管理，客户端只能通过 Parti API 读取状态和提交动作。

我的游戏创意如下（请让我在这里补充玩法、玩家人数、胜负条件和视觉风格）：
[在这里补充你的游戏创意]

如果需求中缺少会影响实现的关键信息，请先提出简短、必要的问题；信息足够后再生成最终结果。最终结果必须：
1. 给出可直接保存的完整文件结构，至少包含 parti.room.json、index.html 和 room.worker.js。
2. 分别输出三个文件的完整内容，不使用省略号、伪代码、占位实现或 Parti 不支持的依赖。
3. 确保 manifest 的入口文件、玩家人数和权限配置与代码一致。
4. 正确实现多人状态同步、服务端动作校验、胜负或结束条件，并安全处理异常或恶意输入。
5. UI 应清晰、响应式，并能在手机端正常操作。
6. 输出前自行复核代码与全部 Parti 文档约束，修正发现的问题。

请将最终答案整理成用户可以逐个保存文件、打包为 ZIP 后直接导入 Parti 的形式。`;

export const DEFAULT_HTML = `<div style="font-family: system-ui, sans-serif; padding: 24px; color: #111;">
  <h1 style="font-size: 24px;">我的房间</h1>
  <div id="count" style="font-size: 48px; font-weight: 800;">0</div>
  <button id="inc" style="font-size: 16px; padding: 10px 18px;">+1</button>
  <script>
    const countEl = document.getElementById('count');
    parti.onState((state) => { countEl.textContent = String(state.count); });
    document.getElementById('inc').onclick = () => parti.action('increment');
    parti.ready();
  </script>
</div>`;

export const DEFAULT_WORKER = `import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  initialState() { return { count: 0 }; },
  actions: {
    increment(ctx) {
      ctx.state.count += 1;
      ctx.broadcast('counter:incremented', { count: ctx.state.count });
    },
  },
});`;

export function blankManifest(): string {
  return JSON.stringify({ partiVersion: '0.1.0', protocolVersion: 1, id: createDraftId(), name: '我的房间', version: '0.1.0', description: '和朋友一起玩的互动房间', entry: { ui: 'index.html', worker: 'room.worker.js' }, room: { minPlayers: 1, maxPlayers: 8 }, sync: { mode: 'snapshot' }, permissions: { network: false, storage: 'session' } }, null, 2);
}
