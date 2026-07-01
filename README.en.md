# Parti

**English** | [简体中文](./README.md)

**Create together. Play together.**

Parti is a web platform and runtime for creating and playing multiplayer interactive rooms. Start from a template or import your own room, then invite friends with a link or QR code. Room creators write HTML and JavaScript while the runtime handles state synchronization, networking, sandboxing, and reconnection.

| I want to… | Start here |
| --- | --- |
| Try Parti | [Open the live app](https://parti.linkai.work/), browse the lobby, create a room, and invite friends |
| Create a room | Read the [room development quickstart](./docs/getting-started.md) or begin with the [complete tic-tac-toe example](./docs/example-tic-tac-toe.md) |
| Work on Parti | See [Local development](#local-development) and [Repository structure](#repository-structure) |

## What Parti provides

- **Create and import**: Start with a blank room or a built-in template, edit room files in the editor, or import a room package from ZIP or GitHub.
- **Instant multiplayer**: A host creates a room in the browser and connects to players over WebRTC; room code can be distributed peer to peer by the host.
- **Simple invitations**: Share a link or QR code, protect a room with a four-digit password, or optionally publish it in the online lobby.
- **Gameplay-first APIs**: Creators submit actions and update authoritative state; the runtime handles the protocol, full-state snapshots, and event broadcasts.
- **Isolated execution**: Room UIs run in sandboxed iframes, while authoritative logic runs in a Web Worker on the host.
- **Recovery built in**: Hosts can restore a room after refresh, and players can return to the same identity and seat after a refresh or brief disconnect.
- **Ready-to-play examples**: The repository includes chat, counter, word guessing, multiplayer snake, and Dou Dizhu rooms.

Parti uses a **host-authoritative** model: players send intentions, while a Worker in the host's browser owns the single authoritative state and synchronizes results to everyone. Creators do not need to manage WebRTC, `postMessage`, sequence numbers, or acknowledgements directly.

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

Place the files in `apps/web/public/rooms/<room-id>/`, or package them as a ZIP and import it in Parti. See the [room development documentation](./docs/README.md) for the complete workflow and constraints.

## Local development

You will need Node.js, [pnpm](https://pnpm.io/), and a modern browser with WebRTC and Web Worker support.

```bash
pnpm install
pnpm dev        # Start the web app at http://localhost:5173
pnpm test       # Run protocol and runtime tests
pnpm typecheck  # Type-check the complete monorepo
pnpm build      # Build the web app
```

Development mode includes local multiplayer preview and DevTools; these are excluded from production builds. Private rooms and invitation links continue to work without a configured lobby service.

### Optional configuration

Copy [`.env.example`](./.env.example) and set the values you need:

```bash
# Enable the public online lobby
VITE_LOBBY_SERVICE_URL=https://<project-ref>.supabase.co/functions/v1/parti-lobby

# Optionally inject a GA4 gtag HTML snippet at build time
GA_MEASUREMENT_SNIPPET=<script>...</script>
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
| [Host Runtime](./docs/host-runtime.md) | Admission, capacity, recovery, and security boundaries |
| [Protocol reference](./docs/protocol-reference.md) | Low-level messages, synchronization, and error codes |
| [Lobby service](./docs/lobby-service.md) | REST API, leases, deployment, and CORS |
