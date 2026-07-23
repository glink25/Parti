# Parti

**English** | [简体中文](./README.md)

**Create together. Play together.**

Parti is a web platform and runtime for creating and playing multiplayer interactive rooms. Start from a template or import your own room, then invite friends with a link or QR code. Room creators write HTML and JavaScript while the runtime handles state synchronization, networking, sandboxing, and reconnection.

| I want to… | Start here |
| --- | --- |
| Try Parti | [Open the live app](https://parti.linkai.work/), browse the lobby, create a room, and invite friends |
| Create with AI | See [Create a multiplayer room with AI](#create-a-multiplayer-room-with-ai): copy the prompt → generate → one-click import → invite friends |
| Write a room by hand | Read the [room development quickstart](./docs/getting-started.md) or begin with the [complete tic-tac-toe example](./docs/example-tic-tac-toe.md) |
| Work on Parti | See [Local development](#local-development) and [Repository structure](#repository-structure) |

## What Parti provides

- **Create and import**: Start with a blank room or a built-in template, edit room files in the editor; generate a room with AI and import it in one click; or import a room package from ZIP or GitHub. You can also browse the "Room Market" tab and install community rooms published on GitHub in one click.
- **Instant multiplayer**: A host creates a room in the browser and connects to players over WebRTC; room code can be distributed peer to peer by the host.
- **Simple invitations**: Share a link or QR code, protect a room with a four-digit password, or optionally publish it in the online lobby.
- **Gameplay-first APIs**: Creators submit actions and update authoritative state; the runtime handles the protocol, full-state snapshots, and event broadcasts.
- **Isolated execution**: Room UIs run in sandboxed iframes, while authoritative logic runs in a Web Worker on the host.
- **Recovery built in**: Hosts can restore a room after refresh, and players can return to the same identity and seat after a refresh or brief disconnect.
- **Ready-to-play examples**: The repository includes chat, counter, word guessing, multiplayer snake, and Dou Dizhu rooms.

Parti uses a **host-authoritative** model: players send intentions, while a Worker in the host's browser owns the single authoritative state and synchronizes results to everyone. Creators do not need to manage WebRTC, `postMessage`, sequence numbers, or acknowledgements directly.

## Create a multiplayer room with AI

You do not need to learn the APIs first. Open the create page on the [live app](https://parti.linkai.work/), copy a Parti-ready prompt, and send it to ChatGPT, Claude, Gemini, or another AI you already use. The model follows the repository `docs` contract and returns complete room code. Paste the reply to import the three files, then invite friends with a link or QR code.

1. On the create page, click “Can’t find the game you want? Let AI build one.”, copy the prompt, and send it to your AI.
2. Add gameplay, player count, win conditions, and visual style, then wait for the full reply.
3. Back in the editor, use “Quick import AI result” to paste the reply into `parti.room.json`, `index.html`, and `room.worker.js`; preview, create the room, and invite friends.

AI-generated code may still have bugs—preview locally before inviting. To write a room from scratch instead, see [Create a room](#create-a-room) below.

## Intended use and limitations

Parti is designed for everyday social settings: gatherings with friends, family entertainment, in-person events, and other lightweight group activities. It works best among people who already trust one another, not as an open, adversarial, or high-risk public service.

Parti provides **no guarantee of cheat prevention, competitive fairness, or adversarial security**. Host-authoritative describes where state is computed and synchronized; it does not make the host, player clients, or room code trustworthy. Do not use Parti for gambling, prize competitions, financial transactions, critical operations, security-sensitive scenarios, or any unlawful purpose.

## Create a room

A minimal Parti room contains three files:

```text
my-room/
  parti.room.json   # Metadata, entry points, and permissions
  index.html        # Room UI running in the sandbox
  room.worker.js    # Authoritative logic running in the host Worker
```

`parti.room.json`:

```json
{
  "partiVersion": "0.1.0",
  "protocolVersion": 1,
  "id": "counter",
  "name": "Multiplayer Counter",
  "version": "0.1.0",
  "entry": {
    "ui": "index.html",
    "worker": "room.worker.js"
  },
  "room": { "minPlayers": 1, "maxPlayers": 8 },
  "sync": { "mode": "snapshot" },
  "permissions": { "network": false, "storage": "session" }
}
```

`room.worker.js`:

```js
import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  initialState() {
    return { count: 0 };
  },
  actions: {
    increment(ctx) {
      ctx.state.count += 1;
    },
  },
});
```

`index.html`:

```html
<button id="increment">+1</button>
<strong id="count">0</strong>

<script>
  parti.onState((state) => {
    document.getElementById('count').textContent = String(state.count);
  });
  document.getElementById('increment').onclick = () => {
    parti.action('increment');
  };
  parti.ready();
</script>
```

Place the files in `apps/web/public/rooms/<room-id>/`, or package them as a ZIP and import it in Parti; or commit the package to your own public repository and register it in the [Room Market](./docs/room-market.en.md) so other users can install it in one click. See the [room development documentation](./docs/README.md) for the complete workflow and constraints.

## Local development

You will need Node.js, [pnpm](https://pnpm.io/), and a modern browser with WebRTC and Web Worker support.

```bash
pnpm install
pnpm dev        # Start the web app at http://localhost:5173
pnpm test       # Run protocol and runtime tests
pnpm typecheck  # Type-check the complete monorepo
pnpm build      # Build apps/room-* first, then bundle them with the web app
```

Development mode includes local multiplayer preview and DevTools; these are excluded from production builds. Private rooms and invitation links continue to work without a configured lobby service.

### Optional configuration

Copy [`.env.example`](./.env.example) and set the values you need:

```bash
# Enable the public online lobby
VITE_LOBBY_SERVICE_URL=https://<project-ref>.supabase.co/functions/v1/parti-lobby

# Override the Room Market's GitHub issue registry (default glink25/Parti)
VITE_MARKET_REGISTRY=<owner>/<repo>
```

The lobby service is backed by the Supabase Edge Function and migration included in this repository. See the [lobby service documentation](./docs/lobby-service.md) for its API, lease, and CORS contract.

## Repository structure

```text
apps/web/                  React + Vite app, online lobby, editor, and room UI
packages/core/             Protocol, Host/Client runtimes, and state synchronization
packages/worker-sdk/       defineRoom, RoomEngine, and Worker host
packages/client-sdk/       iframe parti API and host-page sandbox bridge
packages/transport-local/  In-memory transport for previews and tests
packages/transport-peerjs/ PeerJS / WebRTC transport for online rooms
packages/transport-lan/    LocalSend signaling and WebRTC DataChannel LAN transport
packages/room-packager/    Manifest validation and content-addressed room packages
supabase/                  Optional lobby database migration and Edge Function
docs/                      Room development, API, and runtime documentation
```

Core data flow:

```text
iframe UI
  -> host bridge -> ClientRuntime -> Transport
  -> HostRuntime -> room.worker.js
  -> authoritative state -> snapshot broadcast -> every player's UI
```

The runtime follows these core principles: Runtime First, Protocol Stable, User Code Untrusted, Host Replaceable, Actions Over Messages, and Snapshot First.

## Documentation

| Document | Covers |
| --- | --- |
| [Quickstart](./docs/getting-started.md) | Room model, minimal example, and how to run it |
| [Complete tic-tac-toe example](./docs/example-tic-tac-toe.md) | Building a working multiplayer game from scratch |
| [Worker API](./docs/worker-api.md) | `defineRoom`, actions, context, and lifecycle |
| [Client API](./docs/client-api.md) | The `parti.*` API available inside an iframe |
| [Manifest](./docs/manifest.md) | `parti.room.json` fields and constraints |
| [Room Market](./docs/room-market.en.md) | Publishing flow, `parti.room.zip` packaging format, and label rules |
| [Host Runtime](./docs/host-runtime.md) | Admission, capacity, recovery, and security boundaries |
| [Protocol reference](./docs/protocol-reference.md) | Low-level messages, synchronization, and error codes |
| [Lobby service](./docs/lobby-service.md) | REST API, leases, deployment, and CORS |
| [LAN direct mode](./docs/lan-direct.en.md) | LocalSend discovery, network boundaries, self-hosting, and privacy |

## License

Parti is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE.md). You may use, modify, and distribute Parti for noncommercial purposes. Using Parti for commercial operations or any other profit-making purpose requires prior written permission from the Parti author.

Third-party game rooms published through the Parti Room Market remain the property of their respective authors. Parti's license applies only to Parti itself: it does not claim ownership of third-party game rooms or replace the license chosen by a game room author.

---

## ☕️ Buy Me a Coffee

<details>
<summary>View donation options</summary>

Thank you for supporting Parti! Parti is currently maintained by a single developer, and your donation will support maintenance and continued development.

### Alipay

<img src="./apps/web/public/donation/alipay.png" alt="Alipay payment QR code" width="320">

### Solana (SOL)

Wallet address:

`vEzM9jmxChx2AoMMDpHARHZcUjmUCHdBShwF9eJYGEg`

<img src="./apps/web/public/donation/solana.png" alt="Solana wallet QR code" width="320">

</details>
