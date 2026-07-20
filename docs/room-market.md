# 房间市场（Room Market）

房间市场让 Parti web 直接加载社区作者发布在 GitHub 上的在线房间模版，无需手动下载
zip 或粘贴仓库地址。本文档面向**房间作者 / AI agent**，说明如何把游戏发布到市场；
也面向维护者，说明审核与标签规则。

- 英文版：[room-market.en.md](./room-market.en.md)
- 房间包格式基础：[manifest.md](./manifest.md)、[room-dev-harness.md](./room-dev-harness.md)

## 1. 机制总览

市场由「issue 注册表 + 仓库文件」两段组成，全部依托公开 GitHub 设施与 jsdelivr CDN，
没有额外的服务端：

```
[作者仓库 alice/game-a]                      [Parti 主仓库 glink25/Parti]
  仓库文件（根目录或子目录）                    Issue 区
  ├─ parti.room.json  ─┐                      [parti-room] alice/game-a
  ├─ index.html        │ triage 写入正文       labels: parti-room, beta, recommend
  └─ room.worker.js    ▼                      body: <!-- parti-room:manifest --> 区块
  Release（人工兜底）
  ├─ parti.room.zip    ← 下载后从 ZIP 导入
  └─ parti.room.json
```

- **注册表 = Parti 主仓库的 issue 区**。作者按规范提交 issue；triage workflow 检查
  作者仓库中的房间包有效后，把 manifest 写入 issue 正文的标记区块并打上
  `parti-room` label，房间即上架。
- **列表数据 = issue 列表 API 响应**（manifest 随 `body` 免费返回，一次请求搞定，
  天然避开 GitHub release 下载的 CORS 限制）。
- **安装 = 经 jsdelivr 读取作者仓库文件**：`data.jsdelivr.com` 列文件树，
  `cdn.jsdelivr.net` 逐个拉取，带 CORS 且不消耗 GitHub API 配额。
- **release 中的 `parti.room.zip` = 人工兜底**。浏览器无法可靠地跨域读取 GitHub
  Release 资产，因此 Release 不作为一键安装源；用户下载 zip 后再用「从 ZIP 导入」。
- triage 会用与 Web 相同的解析器实际解包检查 Release ZIP。分支产物无效但 ZIP 合法时，
  条目可以“仅 ZIP”方式降级上架；卡片不会显示一键安装按钮。
- **issue 关闭即下架**。已安装到本地浏览器的副本不受影响。

用户侧流程：创建房间页 →「房间市场」标签页列出上架房间（封面、名称、描述、
beta/推荐徽章）→ 点击「安装」→ 经 jsdelivr 拉取房间包、校验、存入本地 → 与普通
导入模版一样创建房间。加入房间的其他玩家仍通过 P2P 从房主获取房间代码，不接触市场。

## 2. 发布步骤（作者 / AI agent）

### 2.1 准备房间包

按 [getting-started.md](./getting-started.md) 完成房间三件套并通过本地验证：

- `parti.room.json` — manifest，字段与校验规则见 [manifest.md](./manifest.md)
- UI 入口（如 `index.html`）
- Worker 入口（如 `room.worker.js`，必须是单文件、无相对 import）
- 其他静态资源（`packageMode: "filesystem"` 时的图片/音频/样式等）

### 2.2 把房间包提交到仓库（必须）

市场安装直接读取仓库文件，因此**仓库中必须包含完整房间包**：

- 位于仓库**根目录**，或某个**子目录**（如 `dist/`）；
- 目录中必须有 `parti.room.json` 和 manifest `entry` 声明的全部文件；
- 如果仓库中存在多个 `parti.room.json`，预检会按路径由浅到深检查，并选择第一个
  **manifest 合法且声明的全部入口文件均存在**的目录。只有 manifest、没有构建入口的
  `public/` 不会遮蔽同仓库中的完整 `dist/` 包。

两种常见形态：

| 形态 | 做法 |
| --- | --- |
| 纯 HTML/JS 房间（无构建） | 三件套直接放在仓库根目录，推送到默认分支即可 |
| 需要构建的房间 | 推荐由 GitHub Actions 同时把 `dist/` 发布到专用 `parti-package` 分支并创建 Release；issue 标题用 `@parti-package` 锁定（见附录 A） |

封面（可选）：manifest `cover` 可以是绝对 URL，也可以是包内相对路径
（如 `"cover.png"`），市场卡片会按包目录解析展示。

### 2.3 打出 release 资产（推荐的人工兜底）

release 中的 zip 是存档和手动导入通道，不会被静态 Web 自动解包。在房间包目录中执行：

```bash
cd dist   # 或你的房间包目录
zip -r ../parti.room.zip .
cd ..
cp dist/parti.room.json ./parti.room.json
```

创建 release 并上传两个资产：`parti.room.zip` 与 `parti.room.json`（与 zip 内一致）。
`parti.room.zip` 必须能通过 Parti web 的「从 ZIP 导入」成功导入。

### 2.4 提交登记 issue

到 [glink25/Parti 的 issue 区](https://github.com/glink25/Parti/issues) 使用
**「发布房间到市场 / Publish a room」**模板提交 issue：

- 标题（模板会自动填好前缀）：`[parti-room] <owner>/<repo>`
  - 例：`[parti-room] alice/game-a`
  - 锁定 git ref：`[parti-room] alice/game-a@parti-package`。构建型房间推荐使用专用
    `parti-package` 分支；缺省时读取默认分支。
  - Release 人工降级按 ref 类型匹配：缺省分支或显式分支（如 `parti-package`）使用
    latest release；显式 tag（如 `v1.2.0`）只检查同名 release，绝不跨版本切换。
- 正文按模板填写仓库地址、游戏简介、玩家人数等。

### 2.5 等待审核打标

- triage workflow 使用与 Web 相同的解析器检查 git ref 和 Release ZIP，把 manifest、解析后的
  source 元数据以及一个可点击的**房间包源码分支/目录链接**写入 issue 正文。
- git 包完整时正常一键上架；git 包无效但 Release ZIP 合法时以“仅 ZIP”降级上架；
  两者均无效时移除 `parti-room` label。
- 检查失败会在 issue 中评论原因；修复后**编辑 issue**（改一个字即可）会重新触发检查。
- 维护者人工复核后可把 `beta` 换成 `recommend`（表示经过测试、质量可靠）。
- 标签语义：

| Label | 作用 |
| --- | --- |
| `parti-room` | 上架门槛。只有带此 label 的 open issue 会出现在市场列表 |
| `beta` | 卡片显示「测试版」徽章，提示房间可能不完善 |
| `recommend` | 卡片显示「推荐」徽章，表示维护者认可的质量 |

### 2.6 更新与下架

- **更新**：issue 未锁 ref 时，推送代码到默认分支即可（jsdelivr 分支缓存数小时内
  生效）；锁了 tag 则打新 tag 并编辑 issue 标题指向新 tag。更新后**编辑一次 issue**
  让 triage 刷新正文中的 manifest。已安装的用户可点「重新安装」更新本地副本。
- **下架**：关闭登记 issue。已安装的本地副本保留但不再出现在市场。

### 2.7 发布检查清单

- [ ] 仓库中包含 `parti.room.json` 与 `entry` 声明的全部文件，房间可正常游玩
- [ ] manifest 的 `id`、`name`、`version`、`description` 填写完整（列表直接展示）
- [ ]（可选）`cover` 指向包内封面图或绝对 URL
- [ ]（建议）release 包含 `parti.room.zip` / `parti.room.json`，且 zip 能「从 ZIP 导入」
- [ ] issue 标题格式为 `[parti-room] owner/repo`（或 `...@ref`）
- [ ] triage 评论通过后，未删除正文中的 `parti-room:manifest` 标记区块

## 3. 附录 A：推荐的 GitHub Actions 发布配置

适用于需要构建的房间：推送 `v*` tag 时只构建一次，然后同时：

1. 将完整 `dist/` 强制更新到专用 `parti-package` 分支，供市场一键安装；
2. 创建或更新对应 tag 的 Release，并上传 `parti.room.zip` / `parti.room.json` 作人工兜底。

登记 issue 标题使用 `[parti-room] owner/repo@parti-package`。triage 会把该分支识别为
滚动的一键安装源，并校验 latest release 中的 `parti.room.zip` 作为人工下载兜底；Release
仍使用正常的版本 tag（如 `v1.2.0`），不需要创建名为 `parti-package` 的 Release。

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
      - name: Create release and upload archive assets
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          cp dist/parti.room.json parti.room.json
          if gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1; then
            gh release upload "$GITHUB_REF_NAME" parti.room.zip parti.room.json --clobber
          else
            gh release create "$GITHUB_REF_NAME" parti.room.zip parti.room.json \
              --title "$GITHUB_REF_NAME" --generate-notes
          fi
      - name: Publish dist/ to the parti-package branch
        run: |
          publish_dir="$(mktemp -d)"
          cp -R dist/. "$publish_dir/"
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git checkout --orphan parti-package-publish
          git rm -rf . >/dev/null 2>&1 || true
          cp -R "$publish_dir/." .
          git add -A
          git commit -m "parti package $GITHUB_REF_NAME"
          git push -f origin HEAD:parti-package
```

纯 HTML/JS 房间（产物即源码）不需要这个 workflow：三件套放默认分支即可。

## 4. 附录 B：常见失败原因

| 现象 | 原因与处理 |
| --- | --- |
| 市场卡片显示「产物信息尚未写入」 | triage 尚未运行或检查未通过：看 issue 评论；修复后编辑 issue 重新触发 |
| 市场卡片显示「产物信息无效」 | 写入正文的 manifest 不是合法 JSON 或未通过校验（对照 [manifest.md](./manifest.md)） |
| 安装失败「登记的仓库包目录缺少文件」 | issue 中记录的包目录已过期或构建产物不完整；提交完整产物后编辑 issue 重新触发预检。该错误与 release ZIP 内容无关 |
| 安装失败「房间包下载失败」 | 仓库为私有，或 jsdelivr 单文件超过 20MB；可下载 release ZIP 后手动导入 |
| 安装失败「GitHub API 请求受限」 | 解析默认分支的 API 调用被限流（60 次/小时/IP），稍后重试或用卡片上的「浏览器直接下载」+「从 ZIP 导入」 |
| 封面上不显示图片 | `cover` 相对路径按包目录解析，确认图片已提交到仓库同一目录；或改用绝对 URL |
| 更新后内容没变 | jsdelivr 对分支 ref 有数小时缓存；锁定 tag 可保证内容不可变。另需编辑一次 issue 刷新正文 manifest |
| 市场卡片显示“仅 ZIP” | git ref 中没有完整产物，但 Release ZIP 校验通过；按附录 A 发布 `parti-package` 分支并把 issue 改为 `@parti-package` 可恢复一键安装 |
| issue 一直未上架 | git ref 与 Release ZIP 都未通过 triage（看 issue 评论），或维护者移除了 `parti-room` label |
| 市场列表刷新失败 | GitHub API 未认证限速，稍后再试；页面会回退展示缓存内容 |

## 5. 安全与限制说明

- 房间 UI 运行在 `sandbox="allow-scripts allow-same-origin"` 的 iframe 中，房间逻辑
  运行在房主浏览器的 Web Worker 中。沙箱不会自动禁止网络请求（受浏览器 CORS 约束），
  因此**只安装你信任的来源**，优先选择带 `recommend` 徽章的房间。
- `beta` 徽章表示房间未经充分测试，玩法或稳定性可能不完善。
- 市场列表缓存 10 分钟，手动点「刷新」强制更新；jsdelivr 对分支 ref 另有数小时 CDN 缓存。
- 私有仓库无法被 jsdelivr 读取，市场仅支持公开仓库；单个文件超过 20MB 无法经
  jsdelivr 分发。

## 6. 维护者指南

- **上架**：日常由 `.github/workflows/room-issue-triage.yml` 自动完成（检查仓库房间包 →
  写入正文 manifest → 打标）。手动上架时，至少确认 issue 标题格式正确、仓库包含房间包，
  并把 manifest 以 ` ```parti.room.json ` 代码块形式写进正文（web 端兜底解析），再打
  `parti-room` label。
- **质量分级**：实际试玩后，将 `beta` 移除并改打 `recommend`；发现问题的房间移除
  `parti-room`（临时下架）或关闭 issue（永久下架）。
- **滥用处理**：关闭 issue 并按 GitHub 规范处理恶意发布者。
