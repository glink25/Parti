# Room Market

The Room Market lets Parti web load online room templates published by the community on
GitHub — no manual zip downloads or repository URLs needed. This document is written for
**room authors / AI agents** who want to publish a game, and for maintainers who review
submissions.

- 中文版：[room-market.md](./room-market.md)
- Package format basics: [manifest.md](./manifest.md), [room-dev-harness.md](./room-dev-harness.md)

## 1. How it works

The market is a two-part structure built entirely on public GitHub features — no extra
server-side service:

```
[Author repo alice/game-a]              [Parti main repo glink25/Parti]
  Release (latest or a pinned tag)        Issues
  ├─ parti.room.json  ← for listing       [parti-room] alice/game-a
  └─ parti.room.zip   ← the room package  labels: parti-room, beta, recommend
```

- **Registry = the Parti main repo's issue tracker.** An author files an issue in the
  required format; once a maintainer (or the automated triage workflow) verifies the
  release assets and applies the `parti-room` label, the room is listed.
- **Artifacts = two assets in a release of the author's own repository.** Parti web
  downloads them via `https://github.com/<owner>/<repo>/releases/.../download/<asset>`,
  which does not consume GitHub API quota.
- **Closing the issue delists the room.** Copies already installed in a user's browser
  are unaffected.

User flow: open the create-room page → the "Room Market" section lists all published
rooms (name, description, beta/recommended badges) → click "Install" → the
`parti.room.zip` is downloaded, validated, and stored locally → create a room exactly
like any imported template. Players joining the room still receive the room code from
the host over P2P and never touch the market.

## 2. Publishing guide (authors / AI agents)

### 2.1 Prepare the room package

Finish the room's three core files per [getting-started.md](./getting-started.md) and
verify them locally:

- `parti.room.json` — the manifest; fields and validation in [manifest.md](./manifest.md)
- UI entry (e.g. `index.html`)
- Worker entry (e.g. `room.worker.js`; must be a single file with no relative imports)
- Any static assets (images/audio/styles for `packageMode: "filesystem"`)

### 2.2 Build the release assets

From the directory containing the room's **build output**:

```bash
# dist/ contains parti.room.json, index.html, room.worker.js and all assets
cd dist
zip -r ../parti.room.zip .
cd ..
cp dist/parti.room.json ./parti.room.json
```

Create a GitHub release in the room's repository (any tag, e.g. `v1.0.0`) and upload
exactly two assets:

| Asset name (must match exactly) | Content |
| --- | --- |
| `parti.room.json` | The room manifest, **identical to the one inside the zip** |
| `parti.room.zip` | The complete room package, per the format spec below |

#### `parti.room.zip` format spec

- `parti.room.json` sits at the zip root; a single wrapping directory
  (e.g. `game-a/parti.room.json`) is also accepted and stripped on import.
- The entry files declared by manifest `entry.ui` and `entry.worker` must be present.
- Every file declared in the manifest `entry` must exist; undeclared files are not loaded.
- Validation is identical to "Import from ZIP": the manifest must parse and pass
  `validateManifest`, entry files must exist, and `createPackage` full validation must pass.

> Tip: before publishing, test `parti.room.zip` locally with "Import from ZIP" in Parti
> web. If it imports successfully, it satisfies the market format.

### 2.3 File the registry issue

In [glink25/Parti's issue tracker](https://github.com/glink25/Parti/issues), submit with
the **"Publish a room / 发布房间到市场"** template:

- Title (the template pre-fills the prefix): `[parti-room] <owner>/<repo>`
  - Example: `[parti-room] alice/game-a`
  - Pin a specific release: `[parti-room] alice/game-a@v1.0.0` (without `@tag`, the
    repository's latest release is always used — recommended, so cutting a new release
    updates the market entry automatically)
- Fill in the repository URL, a short game description, player counts, etc., to help
  reviewers and users.

### 2.4 Review and labels

- The triage workflow automatically checks that the release contains both required
  assets, then applies the `parti-room` label (listing the room) plus `beta` by default;
  on failure it comments with the reason.
- A maintainer may replace `beta` with `recommend` after a manual review (tested,
  reliable quality).
- Label semantics:

| Label | Effect |
| --- | --- |
| `parti-room` | Listing gate. Only open issues with this label appear in the market |
| `beta` | Shows a "Beta" badge — the room may be incomplete or unstable |
| `recommend` | Shows a "Recommended" badge — quality acknowledged by maintainers |

### 2.5 Updates and delisting

- **Update**: when the issue is not pinned to a tag, just publish a new latest release
  (re-upload both assets). Users see the new version after refreshing the market;
  users who already installed it can click "Reinstall".
- **Delist**: close the registry issue or delete the release. Installed local copies
  remain but the room disappears from the market.

### 2.6 Publishing checklist

- [ ] `parti.room.zip` imports successfully via "Import from ZIP" and the room plays correctly
- [ ] The standalone `parti.room.json` asset is identical to the one inside the zip
- [ ] The release is the latest release (or the issue title pins a tag via `@tag`)
- [ ] Asset filenames are exactly `parti.room.zip` and `parti.room.json`
- [ ] Manifest `id`, `name`, `version`, `description` are filled in (shown in the listing)
- [ ] Issue title matches `[parti-room] owner/repo` (or `...@tag`)

## 3. Appendix A: GitHub Actions packaging example

Add `.github/workflows/release.yml` to the room repository to build and publish
spec-compliant release assets on every tag push. Adjust the build step to your project;
the output directory (`dist/` in the example) must contain the three core files:

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
      # Install dependencies and build; output goes to dist/
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

## 4. Appendix B: Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Market card shows "Package info unavailable" | Release is missing the `parti.room.json` asset; the release is not latest and the issue doesn't pin a tag; the repository is private |
| Market card shows "Package info invalid" | `parti.room.json` is not valid JSON or fails manifest validation (see [manifest.md](./manifest.md)) |
| Install fails with "Failed to download the room package" | Release is missing `parti.room.zip`, or the asset name is misspelled |
| Install fails with "parti.room.json not found in ZIP" | Bad zip layout: the manifest must be at the root or inside a single wrapping directory |
| Install fails with missing UI/worker entry | The zip lacks the files declared by `entry.ui` / `entry.worker`, or the filenames differ |
| Issue never gets listed | The triage check failed (see the issue comments), or a maintainer has not applied the `parti-room` label yet |
| Market list fails to refresh | Unauthenticated GitHub API rate limit (60 requests/hour/IP); try later — the page falls back to cached content |

## 5. Security and limitations

- Room UI runs in a `sandbox="allow-scripts allow-same-origin"` iframe; room logic runs
  in a Web Worker in the host's browser. The sandbox does not block network requests
  (subject to browser CORS), so **only install sources you trust** and prefer rooms with
  the `recommend` badge.
- The `beta` badge means the room has not been fully tested; gameplay or stability may
  be rough.
- Market content is cached for 10 minutes; click "Refresh" to force an update.
- Artifacts in private repositories cannot be downloaded; the market only supports
  public repositories.

## 6. Maintainer guide

- **Listing**: verify the issue title format, that both release assets download, and
  that the zip imports cleanly, then apply the `parti-room` label. Day to day this is
  handled automatically by `.github/workflows/room-issue-triage.yml`; maintainers only
  handle failed checks and disputes.
- **Quality tiers**: after actually playing the room, remove `beta` and apply
  `recommend`; for problematic rooms, remove `parti-room` (temporary delist) or close
  the issue (permanent delist).
- **Abuse**: close the issue and follow GitHub's standard reporting flow for malicious
  publishers.
