# 局域网直连模式

Parti 的“局域网直连”使用兼容 LocalSend Web 的 WebSocket 服务完成设备发现和 WebRTC
信令，房间 Package、快照和游戏消息则通过可靠、有序的 WebRTC DataChannel 在浏览器间
直接传输。游戏代码继续使用相同的 Parti API 和 Room 协议。

## 网络边界

这里的“局域网”不是二层广播。LocalSend 官方服务按 IPv4 公网出口地址或 IPv6 `/64`
对连接分组，因此以下情况都可能出现：

- 同一 Wi-Fi 下的设备因访客网络、VPN、IPv6 配置或防火墙而无法互相发现或连接；
- 不在同一物理网络的设备因 CGNAT 或相同 VPN 出口而出现在同一分组；
- 扫描邀请二维码的设备若不在相同服务端分组中，会按现有连接超时流程失败。

Parti 只配置 STUN，不配置 TURN；游戏数据不会通过中继服务器转发。无法建立直连时不会
自动回退到全网大厅或云端 Transport。

## 默认服务与限制

默认握手地址为 `wss://public.localsend.org/v1/ws`。2026-07-15 实测该服务接受来自
`https://parti.linkai.work` 的 WebSocket 握手；WebSocket 不使用 Fetch CORS 预检，当前
服务也不校验 `Origin`。这不是 LocalSend 对第三方应用的长期兼容承诺。

官方实现当前对每个 IP 分组限制最多 10 个连接，并按每小时 1000 条计数请求限流，且没有
第三方 SLA。Parti 在同一标签页、同一服务器上复用一个连接，但生产部署仍应评估自建服务。
[LocalSend Web 自建说明](https://github.com/localsend/web#self-hosting)与
[服务端实现](https://github.com/localsend/localsend/blob/main/server/src/controller/ws_controller.rs)
可用于核对当前协议和限制。

自定义服务器必须兼容 LocalSend `/v1/ws` 的 `HELLO`、`JOIN`、`UPDATE`、`LEFT`、
`OFFER` 和 `ANSWER` 信令。生产页面只接受 `wss:`；`ws:` 仅允许 localhost，URL 不得
包含凭据、query 或 hash。

## 发现、邀请与隐私

局域网房间创建后默认在大厅“局域网中”分组可见。关闭“局域网可见”只会撤下房间公告，
仍会保留最小直连身份，因此同一分组中持有原邀请链接或二维码的设备仍可加入。它不是安全
边界；需要限制加入时请设置 4 位房间密码。

公告仅包含房间标题、Package 名称、人数、容量、可加入状态和是否需要密码，不包含密码、
邀请 credential 或游戏状态。握手服务仍能看到 Parti 标识、公开公告和 SDP；普通
LocalSend 客户端也可能看到名为 Parti 的设备。Parti 会过滤普通 LocalSend peer、未知
Parti 版本和畸形公告。
