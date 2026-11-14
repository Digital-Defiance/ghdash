# EmDash on GitHub Pages: TODO

Read [SPEC.md](./SPEC.md) first. Tick items as they're done, add notes inline (`→ note`), and update SPEC.md's status line and decision log when anything changes.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (say why)

## Status (2026-11-14)
- **Done:** Phase 0 spike; Phase 1 static site live at https://digital-defiance.github.io/GHDash-example/; 2a minimal editor at `/admin/`; 2b.1–2b.3 and 2b.7 (admin paths configurable, admin boots at `/studio/`, release tarballs).
- **Next:** release `pages-v0.3.0` (admin with the new hooks), then point the demo at it and merge `studio-experiment` to `main`; then media (Phase 3) and the remaining Phase 1 items.
- **Open from Phase 1:** pagination, search, adapter package, `revisions.json`, media, sitemap.

## Phase 0: Spike (prove the risky parts) · est. 1–2 weeks
**Done 2026-11-13.** Results are in SPEC §11, and the code is in `spike/`.
- [x] 0.1 Pick a template and a working approach → `templates/blog`. The spike code lives in `ghpages-port/spike/` and the template change is a patch (`spike/blog-static.patch`), so the template itself stays unmodified.
- [x] 0.2 Static build → works. Live collections resolve at prerender, and `getStaticPaths()` is needed on dynamic routes.
- [x] 0.3 `json-to-sqlite` → `spike/db-json.mjs`. The round trip is lossless and the site rebuilt from JSON is byte-identical. The seed format was rejected as lossy (SPEC D11).
- [x] 0.4 Handlers in the browser → Option A (SPEC D12). The bundle is 258 KB gzipped, needs 5 shims, and runs on `@sqlite.org/sqlite-wasm` in Node and Chromium.
- [x] 0.5 PAT commit through the Git Data API → `spike/github-commit.mjs`. 3 fake-API tests pass, and the live run against `Digital-Defiance/GHDash-example` passed every check (`spike/live-commit-test.mjs`).
- [x] 0.6 Findings written up in SPEC §9/§10/§11. → Go/no-go for Phase 1 is Jessica's call.

## Phase 1: Static site from repo JSON · est. 1 week
Demo and test target: `Digital-Defiance/GHDash-example` (public, Pages to be enabled).
- [x] 1.1 `content/` layout finalised as in SPEC §4.1 (sorted keys, one file per row). Committed in `GHDash-example`.
- [~] 1.2 `json-to-sqlite` is now `scripts/db-json.mjs` + `scripts/build-db.mjs` inside `GHDash-example`, installed from the published `emdash@1.5.0`. **Still to do:** move it into a reusable adapter package (SPEC §8).
- [x] 1.3 GitHub Action (`GHDash-example/.github/workflows/pages.yml`) deployed the site: https://digital-defiance.github.io/GHDash-example/. Checked in headless Chromium on the live site: every page returns 200 except `/search/` (404, known: needs Pagefind), styling and fonts render, no failed requests, and every internal link carries the base path. The first run failed fetching a Google font file and passed on rerun (see 1.7).
- [x] 1.4 Base-path support for project sites (`/<repo>/`): `astro.config.mjs` reads `BASE_PATH`/`SITE_URL`, and `scripts/rebase-urls.mjs` prefixes the template's root-absolute links in built HTML/XML. Verified in a local build.
- [~] 1.4a Template changes: `getStaticPaths()` on the 4 dynamic routes is done (in `GHDash-example`). **Still to do:** path-based pagination instead of `?cursor=` (lists show page 1 only), and a replacement for `/search`.
- [ ] 1.4b Split `revisions.json` per entry, or drop it (SPEC §9 Q3).
- [x] 1.7 Font downloads: the workflow now retries the build up to 3 times, so a transient Google font fetch failure no longer fails the deploy.
- [ ] 1.5 Copy media and optimise images at build time.
- [ ] 1.6 Sitemap, robots and static redirect stubs.

## Phase 2: Browser admin with PAT editing · est. 2–3 weeks
**2a (minimal editor) is done. 2b (the real EmDash admin) is in progress: it boots, and the browser API is next.** 2a is `GHDash-example/public/admin/index.html`: one static file, PAT sign-in, list/create/edit posts and pages (title, excerpt, plain-paragraph body, status), one commit per save, refuses to save if the branch moved. Tested in headless Chromium against a fake GitHub API, and the JSON it wrote rebuilt into the right pages. Bodies with headings, links, images or lists are read-only there so they can't be damaged.
- [x] 2a.1 PAT sign-in with push-permission check, session-storage only.
- [x] 2a.2 Create and edit posts and pages as single commits, with a stale-head conflict check.
- [ ] 2a.3 Try it against the real repo from a real browser (Jessica), and show an Actions status link after saving.
**2b progress (2026-11-13):**
- [x] 2b.1 Fork admin made configurable: new `packages/admin/src/lib/paths.ts` reads `globalThis.__EMDASH_PATHS__ = { adminBase, apiBase, fetch }` (defaults unchanged). `apiFetch` rewrites `/_emdash/api` to `apiBase` and uses `fetch` if given. 12 admin files use `ADMIN_BASE` instead of the literal `/_emdash/admin`. Admin `typecheck` (tsgo) and `oxlint` are clean. Committed on `spike/ghpages-phase0`. Admin unit/browser tests were not run.
- [x] 2b.2 Demo consumes the fork: `GHDash-example` branch `studio-experiment` vendors the fork's admin tarball (`vendor/emdash-cms-admin-1.5.0.tgz`, 11 MB, npm `overrides`). Only admin is vendored; `emdash` core still comes from npm. Not merged to `main` yet because of the 11 MB binary.
- [x] 2b.3 Admin boots under a base path: `/GHDash-example/studio/` mounts `AdminApp`, and its first requests go to `/GHDash-example/_api/manifest` and `/_api/auth/me`. It then shows "Failed to fetch manifest" because nothing answers those calls yet.
- [~] 2b.4 **Browser API: working (2026-11-14), see SPEC D15 and §14a.** EmDash's route files run in the browser on sqlite-wasm; every sidebar page of the real admin loads at `/studio/` and a post edit saves. **Packaging done 2026-11-14:** `pages-tarballs.yml` now also builds the bundle and attaches `ghdash-browser-api-<tag>.tgz` (about 5 MB), and the demo's `scripts/fetch-browser-api.mjs` downloads it at build time (warns and continues if missing; `BROWSER_API_DIR` uses a local build). Release `pages-v0.2.0` is published with the asset; the demo's clean build fetches it and all 14 e2e tests pass against it. **Still to do:** test media upload and settings saves, hide users/passkey UI, make the lock routes not touch the DB (or ignore them in the tray).
- [x] 2b.5 Pending-changes tray built 2026-11-14 (SPEC D14). In the demo's `src/studio/`: `tray.js` turns the in-browser DB into the repo's files (byte-identical to `content/`, same skip rules as `db-json.mjs`), diffs them against the loaded baseline, and applies files back (discard, merge); `controller.js` holds state, sessionStorage token, one-commit Commit through `github-commit.js`; `Tray.tsx` is the toolbar icon, count and dropdown. The admin fork gained `HeaderExtras` and `onQueryClient` hooks in `paths.ts`. 6 unit tests (`npm test`) and 4 tray e2e tests against a fake GitHub API.
- [x] 2b.5a Pending changes persist to IndexedDB (key repo#branch) and are restored only if the baseline head is unchanged.
- [x] 2b.5b Conflict handling: a moved branch keeps pending changes, "Update my copy" fetches the new head through the Git Data API, folds in upstream-only changes, and keeps local versions of files both sides changed (reported). **Limits:** schema (`_ddl.json`) changes can be committed but not merged or discarded; media is not handled; the full-DB snapshot per save is fine for small sites but should become incremental for large ones.
- [x] 2b.6 (done 2026-11-14: the 404 page redirects `/studio/*` to `/studio/?p=...` and the studio entry restores the path) Deep links: Pages serves `404.html` for unknown paths, so `/studio/content/posts` on refresh needs a redirect shim or hash routing.
- [x] 2b.7 Tarballs as GitHub release assets (SPEC D13): release `pages-v0.1.0` on `Digital-Defiance/ghdash` holds `emdash-cms-admin-1.5.0.tgz` and `emdash-1.5.0.tgz`. `GHDash-example` (branch `studio-experiment`) installs the admin from the release URL and `vendor/` is gone from that branch's tip. The old 11 MB blob remains in that branch's history, which is fine because it is not merged to `main`. **Note:** this first tag had to be pushed from a local clone, because the cloud session's git connection drops on tag pushes. To publish a new build: push a new `pages-v*` tag, then update the URLs in the demo's `package.json`.
- [ ] 2.1 Admin static bundle served at `/admin/` → superseded by `/studio/` (2b.3); decide whether `/admin/` becomes the real admin once 2b is stable.
- [ ] 2.2 PAT sign-in screen for the real admin (reuse 2a.1): validate `permissions.push`, sessionStorage, optional remember-me. Feeds `auth/me` in 2b.4.
- [ ] 2.3 Load repo JSON into in-browser SQLite on admin start, with a progress indicator (part of 2b.4; start from `spike/browser-handlers/`). Decide how the migrated empty DB is delivered (SPEC §9 Q6).
- [ ] 2.5 Content CRUD, drafts and publish for posts and pages through the local router (part of 2b.4).
- [ ] 2.7 Settings, schema, taxonomies, menus, widgets, bylines and SEO routes (part of 2b.4).
- [ ] 2.8 "Live in ~1–3 min" notice, with optional Actions run polling (with 2a.3).
- 2.4 (pluggable `apiFetch`) is done as 2b.1; 2.6 (save flow and conflicts) is 2b.5 and 2b.5b.

## Phase 3: Media, search, scheduling · est. 1–2 weeks
- [ ] 3.1 Media upload commits to `media/`, with size warnings and limits.
- [ ] 3.2 Media library backed by `media/_index.json`.
- [ ] 3.3 Pagefind index in the build, plus search UI in templates.
- [ ] 3.4 Cron Action for scheduled publishing.

## Phase 4: Comments · est. 2–4 days
- [ ] 4.1 giscus component for collections with `commentsEnabled`.
- [ ] 4.2 (Optional) Issue-form link, plus an `issues: opened` Action that runs comment hooks, commits JSON and rebuilds.

## Phase 5: Plugins · est. 2–4 weeks
- [ ] 5.1 Load plugin admin UI in the browser admin (`color`, `field-kit`, `embeds`).
- [ ] 5.2 Run before-hooks in the browser before the commit.
- [ ] 5.3 Run after-hooks in the Action for changed entries, with secrets from Actions secrets.
- [ ] 5.4 Plugin cron mapped to a scheduled Action.
- [ ] 5.5 Split secret and non-secret plugin settings, and strip secrets on export.
- [ ] 5.6 Document per plugin what doesn't work (public routes).
- [ ] 5.7 (Later) Sandboxed plugin runner (Web Worker or Node), and installing marketplace plugins by committing their code.

## Phase 6: Hardening and docs
- [ ] 6.1 Admin CSP and PAT handling review.
- [ ] 6.2 "Create a site from this template" repo and a setup guide (PAT creation, Pages settings, secrets).
- [~] 6.3 Tests: Playwright suite in `GHDash-example/e2e/` (14 tests: static pages and links, studio load, every sidebar page, edit and create a post, deep link) and `.github/workflows/e2e.yml`. Studio tests skip in CI until the browser API bundle is built into `dist/` (release asset, 2b.4). **Still to do:** JSON round trip, commit/conflict flow, tray tests.
- [ ] 6.4 Rebase plan and checklist for pulling in upstream EmDash.

## Log
- 2026-11-13: Spec and TODO created after the feasibility review.
- 2026-11-13: Phase 0 spike run. 0.2–0.4 pass, and 0.5 passes against a fake API with the live run pending. D11 and D12 added to SPEC.
- 2026-11-13: Live commit test passed. Phase 0 complete. The spike is on branch `spike/ghpages-phase0`.
- 2026-11-13: Phase 1 first cut pushed to `Digital-Defiance/GHDash-example` (main). Local clean-clone build gives 18 pages with the right base path. The Pages deploy waits on enabling Pages in repo settings.
- 2026-11-13: Pages enabled by Jessica and the first successful deploy is live. A font-fetch flake needed one rerun.
- 2026-11-13: Minimal editor (2a) built and deployed to GHDash-example `/admin/`. Retry added for font flake.
- 2026-11-13: The sandbox network allowlist now includes `digital-defiance.github.io`, so the live site can be tested from a session. Live check passed.
- 2026-11-13: Admin paths made configurable in the fork. The real admin boots at `/studio/` in the demo (branch `studio-experiment`) and asks for `manifest` and `auth/me`. The browser API (2b.4) is next.
- 2026-11-13: Decided release-asset tarballs (D13) and a pending-changes tray with a commit button (D14), both from Jessica. Release workflow pushed; the first tag still needs pushing from a local clone.
- 2026-11-14: README and TODO refreshed; browser API (2b.4) starting.
- 2026-11-13: Release `pages-v0.1.0` built by the workflow (success) with the admin and core tarballs. The demo's `studio-experiment` branch now installs from it.
- 2026-11-14: Switched to running EmDash's own route files in the browser (D15); all sidebar pages load.
- 2026-11-14: Browser API first cut: admin shell renders at /studio/ with real collections. Dashboard and content routes next.
- 2026-11-14: e2e suite added (14 passing locally); deep links fixed.
- 2026-11-14: Browser API packaged as a release asset; release pages-v0.2.0 published (first push of the tag hit the wrong commit and was redone); clean demo build plus 14 e2e tests pass against it.
- 2026-11-14: Pending-changes tray, commit and conflict flow built; 18 e2e and 6 unit tests pass locally. Needs release pages-v0.3.0 for the admin hooks.
