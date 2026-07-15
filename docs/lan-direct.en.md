# LAN direct mode

Parti LAN Direct uses a LocalSend Web-compatible WebSocket service for discovery and WebRTC
signaling. Room packages, snapshots, and game messages travel directly between browsers over
reliable, ordered WebRTC DataChannels. Games keep using the same Parti API and room protocol.

## Network boundary

“LAN” is not layer-2 broadcast here. The official LocalSend service groups connections by exact
public IPv4 address or IPv6 `/64`. Consequently:

- devices on one Wi-Fi may not discover or reach each other because of guest isolation, VPNs,
  IPv6 routing, or firewalls;
- physically separate devices may appear together behind CGNAT or the same VPN egress;
- scanning an invite outside the same server-side group naturally follows the existing connection
  timeout path.

Parti configures STUN only and no TURN, so game data is never relayed through a TURN server. A
failed direct connection does not fall back to the global lobby or a cloud transport.

## Default service and limits

The default signaling URL is `wss://public.localsend.org/v1/ws`. On 2026-07-15 it accepted a
WebSocket handshake with the `https://parti.linkai.work` origin. WebSockets do not use Fetch CORS
preflight and the current server does not validate `Origin`; this is not a long-term third-party
compatibility guarantee from LocalSend.

The official implementation currently allows at most 10 connections per IP group and rate-limits
counted requests to 1,000 per hour, with no third-party SLA. Parti shares one connection per tab
and server, but production operators should still consider a self-hosted endpoint.
[LocalSend Web self-hosting](https://github.com/localsend/web#self-hosting) and the
[server implementation](https://github.com/localsend/localsend/blob/main/server/src/controller/ws_controller.rs)
document the current protocol and limits.

Custom servers must implement LocalSend `/v1/ws` signaling for `HELLO`, `JOIN`, `UPDATE`, `LEFT`,
`OFFER`, and `ANSWER`. Production pages accept only `wss:`; `ws:` is limited to localhost, and
credentials, query strings, and fragments are rejected.

## Discovery, invites, and privacy

LAN rooms are visible in the lobby’s “On your network” section by default. Hiding a room removes
its announcement but retains the minimum direct-connect identity, so a device in the same group
with the original link or QR code can still join. Visibility is not an access-control boundary;
use the existing four-digit room password when admission must be restricted.

Announcements contain only the title, package name, player count, capacity, joinability, and
whether a password is required. They never contain the password, invite credential, or game state.
The signaling service can still observe the Parti marker, public summary, and SDP, and ordinary
LocalSend clients may see a Parti-labelled device. Parti filters non-Parti peers, unknown Parti
versions, and malformed announcements.
