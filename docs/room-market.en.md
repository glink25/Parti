# Room Market

The Room Market lets Parti web load online room templates published by the community on
GitHub — no manual zip downloads or repository URLs needed. This document is written for
**room authors / AI agents** who want to publish a game, and for maintainers who review
submissions.

- 中文版：[room-market.md](./room-market.md)
- Package format basics: [manifest.md](./manifest.md), [room-dev-harness.md](./room-dev-harness.md)

## 1. How it works

The market combines an "issue registry + repository files" structure, built entirely on
public GitHub facilities and the jsdelivr CDN — no extra server-side service:

```
[Author repo alice/game-a]                   [Parti main repo glink25/Parti]
  Repository files (root or a subdirectory)    Issues
  ├─ parti.room.json  ─┐                       [parti-room] alice/game-a
  ├─ index.html        │ triage embeds in body labels: parti-room, beta, recommend
  └─ room.worker.js    ▼                       body: <!-- parti-room:manifest --> block
  Release (optional archive)
  ├─ parti.room.zip    ← manual-import fallback
  └─ parti.room.json
```

- **Registry = the Parti main repo's issue tracker.** An author files an issue in the
  required format; the triage workflow verifies the room package in the author's
  repository, embeds the manifest into the issue body's marker block, and applies the
  `parti-room` label — the room is listed.
- **Listing data = the issues API response** (the manifest rides along in `body` for
  free — one request, and no dependence on GitHub release downloads, which lack CORS
  headers).
- **Install = reading the author's repository files via jsdelivr**:
  `data.jsdelivr.com` lists the file tree, `cdn.jsdelivr.net` serves each file — CORS
  enabled and no GitHub API quota consumed.
- **`parti.room.zip` in a release = optional archive.** If online installation fails
  (e.g. network issues), users can "Download in browser" from the card and install
  manually via "Import from ZIP".
- **Closing the issue delists the room.** Copies already installed in a user's browser
  are unaffected.

User flow: create-room page → the "Room Market" tab lists published rooms (cover, name,
description, beta/recommended badges) → click "Install" → the package is fetched via
jsdelivr, validated, and stored locally → create a room exactly like any imported
template. Players joining the room still receive the room code from the host over P2P
and never touch the market.

## 2. Publishing guide (authors / AI agents)

### 2.1 Prepare the room package

Finish the room's three core files per [getting-started.md](./getting-started.md) and
verify them locally:

- `parti.room.json` — the manifest; fields and validation in [manifest.md](./manifest.md)
- UI entry (e.g. `index.html`)
- Worker entry (e.g. `room.worker.js`; must be a single file with no relative imports)
- Any static assets (images/audio/styles for `packageMode: "filesystem"`)

### 2.2 Commit the room package to the repository (required)

Installation reads repository files directly, so **the repository must contain the
complete room package**:

- At the repository **root**, or inside a **subdirectory** (e.g. `dist/`);
- The directory must contain `parti.room.json` and every file declared in the manifest
  `entry`;
- If multiple `parti.room.json` files exist, the **shallowest** one marks the package
  location (same rule as ZIP import's prefix stripping).

Two common shapes:

| Shape | How |
| --- | --- |
| Plain HTML/JS room (no build) | Put the three files at the repository root and push to the default branch |
| Room with a build step | Commit the build output to a directory/branch (see the CI example in Appendix A, which pushes `dist/` to a `parti-package` branch; pin it in the issue title via `@parti-package`) |

Cover (optional): the manifest `cover` may be an absolute URL or a package-relative path
(e.g. `"cover.png"`); market cards resolve it against the package directory.

### 2.3 Build the release assets (optional, recommended)

The release zip is an archive and the manual-import fallback. From the package
directory:

```bash
cd dist   # or your package directory
zip -r ../parti.room.zip .
cd ..
cp dist/parti.room.json ./parti.room.json
```

Create a release and upload two assets: `parti.room.zip` and `parti.room.json`
(identical to the one inside the zip). The `parti.room.zip` must import successfully
via "Import from ZIP" in Parti web.

### 2.4 File the registry issue

In [glink25/Parti's issue tracker](https://github.com/glink25/Parti/issues), submit with
the **"Publish a room / 发布房间到市场"** template:

- Title (the template pre-fills the prefix): `[parti-room] <owner>/<repo>`
  - Example: `[parti-room] alice/game-a`
  - Pin a git ref: `[parti-room] alice/game-a@v1.0.0` (tag or branch; without `@ref` the
    default branch is always used — recommended, so pushing updates refreshes the market
    entry. Note jsdelivr caches branch refs for hours; a pinned tag is immutable)
- Fill in the repository URL, a short game description, player counts, etc.

### 2.5 Review and labels

- The triage workflow automatically: locates the shallowest `parti.room.json` in the
  repository tree, downloads and validates the manifest, **embeds the manifest and the
  package directory into the issue body's marker block** (do not delete it), and applies
  `parti-room` (listing) + `beta`. Missing release assets only trigger a reminder
  comment — they don't block listing.
- On failure it comments with the reason; after fixing, **edit the issue** (any small
  change) to re-trigger the check.
- A maintainer may replace `beta` with `recommend` after a manual review.
- Label semantics:

| Label | Effect |
| --- | --- |
| `parti-room` | Listing gate. Only open issues with this label appear in the market |
| `beta` | Shows a "Beta" badge — the room may be incomplete or unstable |
| `recommend` | Shows a "Recommended" badge — quality acknowledged by maintainers |

### 2.6 Updates and delisting

- **Update**: when the issue is not pinned, push to the default branch (takes effect
  within jsdelivr's branch cache of a few hours); when pinned, cut a new tag and edit
  the issue title to point at it. After updating, **edit the issue once** so triage
  refreshes the embedded manifest. Users who already installed can click "Reinstall".
- **Delist**: close the registry issue. Installed local copies remain but the room
  disappears from the market.

### 2.7 Publishing checklist

- [ ] The repository contains `parti.room.json` and all files declared in `entry`; the room plays correctly
- [ ] Manifest `id`, `name`, `version`, `description` are filled in (shown in the listing)
- [ ] (Optional) `cover` points to a cover image inside the package or an absolute URL
- [ ] (Recommended) The release contains `parti.room.zip` / `parti.room.json`, and the zip imports via "Import from ZIP"
- [ ] Issue title matches `[parti-room] owner/repo` (or `...@ref`)
- [ ] After triage passes, the `parti-room:manifest` marker block in the issue body is kept intact

## 3. Appendix A: GitHub Actions publishing example

For rooms with a build step: on tag push, build → upload archive release assets → push
the build output to a `parti-package` branch (which the market installs from). Register
the issue with title `[parti-room] owner/repo@parti-package`.

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
      - name: Create release and upload archive assets
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          cp dist/parti.room.json parti.room.json
          gh release create "$GITHUB_REF_NAME" parti.room.zip parti.room.json \
            --title "$GITHUB_REF_NAME" --generate-notes
      - name: Publish dist/ to the parti-package branch
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git checkout --orphan parti-package-tmp
          git rm -rf . >/dev/null 2>&1 || true
          cp -r dist/* .
          git add -A
          git commit -m "parti package $GITHUB_REF_NAME"
          git push -f origin HEAD:parti-package
```

Plain HTML/JS rooms (output equals source) don't need this workflow: keep the three
files on the default branch.

## 4. Appendix B: Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Market card shows "Package info not written yet" | Triage hasn't run or its check failed: read the issue comments; fix and edit the issue to re-trigger |
| Market card shows "Package info invalid" | The embedded manifest is not valid JSON or fails validation (see [manifest.md](./manifest.md)) |
| Install fails with "Failed to download the room package" | The repository lacks `parti.room.json` or files declared in `entry`; the repository is private; a single file exceeds jsdelivr's 20MB limit |
| Install fails with "GitHub API rate limit reached" | The default-branch lookup call was throttled (60/hour/IP); retry later or use the card's "Download in browser" + "Import from ZIP" |
| Cover image doesn't show | Relative `cover` paths resolve against the package directory — commit the image next to the manifest, or use an absolute URL |
| Content didn't change after an update | jsdelivr caches branch refs for hours; pin a tag for immutable content. Also edit the issue once to refresh the embedded manifest |
| Issue never gets listed | The triage check failed (see the issue comments), or a maintainer has not applied the `parti-room` label yet |
| Market list fails to refresh | Unauthenticated GitHub API rate limit; try later — the page falls back to cached content |

## 5. Security and limitations

- Room UI runs in a `sandbox="allow-scripts allow-same-origin"` iframe; room logic runs
  in a Web Worker in the host's browser. The sandbox does not block network requests
  (subject to browser CORS), so **only install sources you trust** and prefer rooms with
  the `recommend` badge.
- The `beta` badge means the room has not been fully tested; gameplay or stability may
  be rough.
- The market list is cached for 10 minutes; click "Refresh" to force an update. jsdelivr
  additionally caches branch refs for hours.
- Private repositories cannot be read by jsdelivr; the market only supports public
  repositories. Single files over 20MB cannot be distributed via jsdelivr.

## 6. Maintainer guide

- **Listing**: normally handled by `.github/workflows/room-issue-triage.yml` (verify the
  repository package → embed the manifest in the body → label). To list manually, verify
  the title format and the repository package, paste the manifest into the body as a
  ` ```parti.room.json ` fenced block (the web app parses it as a fallback), then apply
  the `parti-room` label.
- **Quality tiers**: after actually playing the room, remove `beta` and apply
  `recommend`; for problematic rooms, remove `parti-room` (temporary delist) or close
  the issue (permanent delist).
- **Abuse**: close the issue and follow GitHub's standard reporting flow for malicious
  publishers.
