# 房间市场（Room Market）

房间市场让 Parti web 直接加载社区作者发布在 GitHub 上的在线房间模版，无需手动下载
zip 或粘贴仓库地址。本文档面向**房间作者 / AI agent**，说明如何把游戏发布到市场；
也面向维护者，说明审核与标签规则。

- 英文版：[room-market.en.md](./room-market.en.md)
- 房间包格式基础：[manifest.md](./manifest.md)、[room-dev-harness.md](./room-dev-harness.md)

## 1. 机制总览

市场由两段式结构组成，全部依托公开的 GitHub 功能，没有额外的服务端：

```
[作者仓库 alice/game-a]                [Parti 主仓库 glink25/Parti]
  Release（latest 或指定 tag）           Issue 区
  ├─ parti.room.json  ← 列表展示用        [parti-room] alice/game-a
  └─ parti.room.zip   ← 实际房间包        labels: parti-room, beta, recommend
```

- **注册表 = Parti 主仓库的 issue 区**。作者按规范提交一条 issue；维护者（或自动
  triage workflow）检查产物有效后打上 `parti-room` label，房间即上架。
- **产物 = 作者自己仓库 release 中的两个资产**。Parti web 通过
  `https://github.com/<owner>/<repo>/releases/.../download/<资产名>` 直接下载，
  不消耗 GitHub API 配额。
- **issue 关闭即下架**。已安装到本地浏览器的副本不受影响。

用户侧流程：打开创建房间页 →「房间市场」区块列出所有上架房间（名称、描述、
beta/推荐徽章）→ 点击「安装」→ 下载 `parti.room.zip`、校验、存入本地 → 与普通
导入模版一样创建房间。加入房间的其他玩家仍通过 P2P 从房主获取房间代码，不接触市场。

## 2. 发布步骤（作者 / AI agent）

### 2.1 准备房间包

按 [getting-started.md](./getting-started.md) 完成房间三件套并通过本地验证：

- `parti.room.json` — manifest，字段与校验规则见 [manifest.md](./manifest.md)
- UI 入口（如 `index.html`）
- Worker 入口（如 `room.worker.js`，必须是单文件、无相对 import）
- 其他静态资源（`packageMode: "filesystem"` 时的图片/音频/样式等）

### 2.2 打出 release 资产

在存放房间**构建产物**的目录中执行：

```bash
# dist/ 内含 parti.room.json、index.html、room.worker.js 及全部静态资源
cd dist
zip -r ../parti.room.zip .
cd ..
cp dist/parti.room.json ./parti.room.json
```

然后在 GitHub 仓库创建一个 release（tag 任意，如 `v1.0.0`），上传两个资产：

| 资产名（必须完全一致） | 内容 |
| --- | --- |
| `parti.room.json` | 房间 manifest，**与 zip 内的 `parti.room.json` 完全相同** |
| `parti.room.zip` | 完整房间产物，见下方格式规范 |

#### `parti.room.zip` 格式规范

- zip 根目录直接包含 `parti.room.json`；也允许恰好一层包裹目录
  （如 `game-a/parti.room.json`），导入时会自动剥离。
- 必须包含 manifest `entry.ui` 和 `entry.worker` 声明的入口文件。
- manifest 中 `entry` 声明的全部文件都必须存在；未声明的文件不会被加载。
- 校验规则与「从 ZIP 导入」完全一致：manifest 可解析并通过
  `validateManifest`，入口文件存在，`createPackage` 全量校验通过。

> 提示：发布前可以在 Parti web 的「从 ZIP 导入」里本地验证 `parti.room.zip`，
> 能成功导入即满足市场格式要求。

### 2.3 提交登记 issue

到 [glink25/Parti 的 issue 区](https://github.com/glink25/Parti/issues) 使用
**「发布房间到市场 / Publish a room」**模板提交 issue：

- 标题（模板会自动填好前缀）：`[parti-room] <owner>/<repo>`
  - 例：`[parti-room] alice/game-a`
  - 锁定指定 release：`[parti-room] alice/game-a@v1.0.0`（缺省始终读取该仓库
    latest release，推荐缺省，这样更新 release 即更新市场内容）
- 正文按模板填写仓库地址、游戏简介、玩家人数等，方便审核与其他用户了解。

### 2.4 等待审核打标

- triage workflow 会自动检查 release 中是否存在两个规范资产，通过后打上
  `parti-room` label（上架）并默认附加 `beta`；失败会在 issue 中评论原因。
- 维护者人工复核后可把 `beta` 换成 `recommend`（表示经过测试、质量可靠）。
- 标签语义：

| Label | 作用 |
| --- | --- |
| `parti-room` | 上架门槛。只有带此 label 的 open issue 会出现在市场列表 |
| `beta` | 卡片显示「测试版」徽章，提示房间可能不完善 |
| `recommend` | 卡片显示「推荐」徽章，表示维护者认可的质量 |

### 2.5 更新与下架

- **更新**：issue 未锁定 tag 时，在仓库发布新的 latest release（重新上传两个资产）
  即可，用户刷新市场后看到新版本；已安装的用户可点「重新安装」更新本地副本。
- **下架**：关闭登记 issue，或删除 release。已安装的本地副本保留但不再出现在市场。

### 2.6 发布检查清单

- [ ] 本地「从 ZIP 导入」`parti.room.zip` 成功，房间可正常游玩
- [ ] zip 内 `parti.room.json` 与单独上传的 `parti.room.json` 内容一致
- [ ] release 为 latest（或 issue 标题中用 `@tag` 锁定了目标 release）
- [ ] 两个资产文件名严格为 `parti.room.zip` / `parti.room.json`
- [ ] manifest 的 `id`、`name`、`version`、`description` 填写完整（列表直接展示）
- [ ] issue 标题格式为 `[parti-room] owner/repo`（或 `...@tag`）

## 3. 附录 A：GitHub Actions 自动打包示例

在房间仓库中加入 `.github/workflows/release.yml`，推送 tag 时自动构建并发布
规范格式的 release 资产。按你的构建命令调整「Build」步骤，只要最终产物目录
（示例为 `dist/`）包含三件套即可：

```yaml
name: release
on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  package:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      # 按项目实际情况安装依赖并构建，产物输出到 dist/
      - run: npm ci && npm run build
      - name: Package parti.room.zip
        working-directory: dist
        run: zip -r "$GITHUB_WORKSPACE/parti.room.zip" .
      - name: Create release and upload assets
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          cp dist/parti.room.json parti.room.json
          gh release create "$GITHUB_REF_NAME" parti.room.zip parti.room.json \
            --title "$GITHUB_REF_NAME" --generate-notes
```

## 4. 附录 B：常见失败原因

| 现象 | 原因与处理 |
| --- | --- |
| 市场卡片显示「产物信息不可用」 | release 缺少 `parti.room.json` 资产；release 不是 latest 且 issue 未用 `@tag` 锁定；仓库为私有 |
| 市场卡片显示「产物信息无效」 | `parti.room.json` 不是合法 JSON 或未通过 manifest 校验（对照 [manifest.md](./manifest.md)） |
| 安装失败「房间包下载失败」 | release 缺少 `parti.room.zip`，或资产名拼写不一致 |
| 安装失败「ZIP 中未找到 parti.room.json」 | zip 结构不符：manifest 必须在根目录或唯一一层包裹目录内 |
| 安装失败「缺少 UI/worker 入口文件」 | zip 内缺少 `entry.ui` / `entry.worker` 声明的文件，或文件名不一致 |
| issue 一直未上架 | triage 检查未通过（看 issue 评论），或维护者尚未打 `parti-room` label |
| 市场列表刷新失败 | GitHub API 未认证限速（60 次/小时/IP），稍后再试；页面会回退展示缓存内容 |

## 5. 安全与限制说明

- 房间 UI 运行在 `sandbox="allow-scripts allow-same-origin"` 的 iframe 中，房间逻辑
  运行在房主浏览器的 Web Worker 中。沙箱不会自动禁止网络请求（受浏览器 CORS 约束），
  因此**只安装你信任的来源**，优先选择带 `recommend` 徽章的房间。
- `beta` 徽章表示房间未经充分测试，玩法或稳定性可能不完善。
- 市场内容缓存 10 分钟，手动点「刷新」强制更新。
- 私有仓库的产物无法被下载，市场仅支持公开仓库。

## 6. 维护者指南

- **上架**：确认 issue 标题格式正确、release 两个资产可下载且 zip 能导入后，打
  `parti-room` label。日常由 `.github/workflows/room-issue-triage.yml` 自动完成，
  维护者处理失败评论和争议即可。
- **质量分级**：实际试玩后，将 `beta` 移除并改打 `recommend`；发现问题的房间移除
  `parti-room`（临时下架）或关闭 issue（永久下架）。
- **滥用处理**：关闭 issue 并按 GitHub 规范处理恶意发布者。
