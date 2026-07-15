# Agent Rules for Game Room Development

The rules in this section apply whenever an agent creates, modifies, debugs, or reviews a game room. They are defaults and may be overridden only by an explicit instruction from the user for the current task.

## 1. Do not design for room-data version migration

- A game's version is locked when the player enters the game. A running game will never be upgraded or downgraded in place.
- The project currently has no saved-game concept. Room data is not loaded across game versions.
- A room-data `schema` or version discriminator only identifies the data shape. It is not a request to implement migrations, compatibility adapters, fallbacks, or upgrade/downgrade paths.
- Do not add backward compatibility, forward compatibility, migration code, legacy-data handling, or tests for cross-version room data unless the user explicitly asks for them.
- Implement and validate only the data shape required by the current version.

## 2. Never commit Git changes by default

- Do not run `git commit`, create commits, amend commits, or otherwise commit on the user's behalf unless the user explicitly asks for it.
- Leaving changes unstaged or staged does not grant permission to commit. The user performs the final commit manually by default.

## 3. Do not use browser-based visual verification by default

- Do not invoke browser-control skills or tools to open, play, inspect, screenshot, or visually verify a game unless the user explicitly requests browser use.
- Game feel, presentation, and runtime behavior must be verified by a human player. Agent-driven browser interaction is not accepted as reliable gameplay validation.
- When browser verification was not requested, report what was checked statically and clearly leave actual gameplay verification to the user.

## 4. Keep tests limited to useful pure-logic coverage

- Do not add tests by default for UI behavior, rendering, interactions, animation, audio, timing, networking, framework wiring, or full game flows.
- Tests may be added for pure functions and deterministic, framework-independent game logic when they provide clear value.
- Do not introduce mocks, test harnesses, fixtures, or abstractions merely to make non-pure game code testable.
- Running the actual game with a human player is the authoritative validation for integrated game behavior.

## 5. Do not spawn review sub-agents for simple changes

- Handle small, localized, low-risk code changes directly. Do not create a sub-agent solely to review such changes.
- Use sub-agents only when the user explicitly requests them or when the task is genuinely large enough to benefit from independent parallel work. Never use them as a routine completion ritual.

## 6. Treat Parti internals as opaque during game development

- For a new game or an iteration of an existing game, read only:
  - the relevant files under `docs/` that define the public contract; and
  - same-level game projects that the user explicitly names as references.
- Do not browse, search, or study unrelated Parti application, package, runtime, server, protocol-implementation, or infrastructure source code for examples or context.
- Do not independently choose another game room as a reference. A sibling game may be read only when the user explicitly identifies it.
- Develop against the documented protocol. Assume the Parti implementation already satisfies that protocol and is transparent to game-room developers.
- Reading underlying implementation is allowed only when there is concrete evidence of a lower-level protocol/runtime bug and inspecting it is necessary to diagnose that bug. State that reason before expanding the investigation.
- If the public documentation is insufficient, ask the user for the missing contract detail or for permission to inspect a specific implementation area instead of exploring the repository broadly.
