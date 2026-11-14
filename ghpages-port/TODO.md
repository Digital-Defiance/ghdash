# EmDash on GitHub Pages: TODO

Read [SPEC.md](./SPEC.md) first. Tick items as they're done, add notes inline (`→ note`), and update SPEC.md's status line and decision log when anything changes.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (say why)

## Status (2026-11-14)
- **Done and merged to `main` of `GHDash-example`:** Phase 0 spike; the studio as part of the adapter package (release `pages-v0.7.0`); giscus comments; template repo and `SETUP.md` (6.2); revisions split per row (1.4b); image downscale (1.5); Phase 1 (static site, path pagination, Pagefind search, sitemap/robots/redirects, adapter package `@digital-defiance/ghdash-pages`); Phase 2b (real admin at `/studio/`, pending-changes tray, one-commit saves, real-token commit verified); media upload (3.1–3.3); scheduled publishing (3.4); header "View Site" base path.
- **Live:** https://digital-defiance.github.io/GHDash-example/ and `/studio/`; releases up to `pages-v0.9.0` (admin, core, browser API, adapter).
- **Needs the site owner:** giscus comments (4.1) are merged but stay off until Discussions is enabled, the giscus app is installed and `giscus.json` is committed.
- **Next:** plugins (Phase 5), hardening (Phase 6).
- **Known gaps:** media over 10 MB is rejected; editor-inline images keep `/_emdash/api/media/file/...` URLs inside the studio; images are only downscaled (no srcset or WebP yet); the admin's Comments screen only lists server-side comments; `test/live.mjs` has not run (needs the Bearer secret in a session).

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
- [x] 1.2 The build scripts live in the adapter package `@digital-defiance/ghdash-pages` (`ghpages-port/adapter/`, a `ghdash-pages` command: build-db, export-content, studio-assets, fetch-browser-api, copy-media, finish, serve). It is packed as a release asset by `pages-tarballs.yml`, and `GHDash-example` installs it from the release URL. The in-browser studio (boot, tray, controller, commit code) is in the same package under `studio/` (version 0.2.0, release `pages-v0.7.0`) and a site imports `@digital-defiance/ghdash-pages/studio/boot.tsx` from a small `/studio/` page. **Still in the site template:** the Pagefind search page and the page templates.
- [x] 1.3 GitHub Action (`GHDash-example/.github/workflows/pages.yml`) deployed the site: https://digital-defiance.github.io/GHDash-example/. Checked in headless Chromium on the live site: every page returns 200 except `/search/` (404, known: needs Pagefind), styling and fonts render, no failed requests, and every internal link carries the base path. The first run failed fetching a Google font file and passed on rerun (see 1.7).
- [x] 1.4 Base-path support for project sites (`/<repo>/`): `astro.config.mjs` reads `BASE_PATH`/`SITE_URL`, and `scripts/rebase-urls.mjs` prefixes the template's root-absolute links in built HTML/XML. Verified in a local build.
- [x] 1.4a Template changes in `GHDash-example`: `getStaticPaths()` on the dynamic routes; path-based pagination (`/posts/page/2/`, `/tag/<slug>/page/2/`, same for categories; `PAGE_SIZE` env var overrides the default of 20 at build time); `/search/` is a static page that queries a Pagefind index in the browser.
- [x] 1.4b `revisions` is one file per row (`content/revisions/<id>.json`), like content rows, so a save touches one small file. Older `revisions.json` is still read; `ghdash-pages split-revisions` migrates it. The tray folds a revision into its post's change. Adapter 0.3.0, released as `pages-v0.8.0`, merged.
- [x] 1.7 Font downloads: the workflow now retries the build up to 3 times, so a transient Google font fetch failure no longer fails the deploy.
- [~] 1.5 Media: the build copies repo `media/` to `public/media/` and rewrites `/_emdash/api/media/file/<key>` to `<base>/media/<key>`. The copy downscales images wider than `MEDIA_MAX_WIDTH` (default 2000px) with sharp (adapter 0.4.0, released as `pages-v0.9.0`, merged). **Still to do:** srcset and WebP.
- [x] 1.6 `sitemap.xml` and `robots.txt` are generated endpoints in `GHDash-example` (absolute URLs including the base path; `/studio/` and `/admin/` disallowed). The RSS feed links now include the base path too (they didn't before). Redirects: `scripts/redirects.mjs` turns enabled rows of `content/_emdash_redirects.json` into meta-refresh pages after the build; pattern redirects are skipped with a warning (static hosting can't do them). Unit-tested; e2e covers sitemap, robots and feed.

## Phase 2: Browser admin with PAT editing · est. 2–3 weeks
**2a (minimal editor) is done. 2b (the real EmDash admin) is in progress: it boots, and the browser API is next.** 2a is `GHDash-example/public/admin/index.html`: one static file, PAT sign-in, list/create/edit posts and pages (title, excerpt, plain-paragraph body, status), one commit per save, refuses to save if the branch moved. Tested in headless Chromium against a fake GitHub API, and the JSON it wrote rebuilt into the right pages. Bodies with headings, links, images or lists are read-only there so they can't be damaged.
- [x] 2a.1 PAT sign-in with push-permission check, session-storage only.
- [x] 2a.2 Create and edit posts and pages as single commits, with a stale-head conflict check.
- [x] 2a.3 Real-browser try-out done 2026-11-14: Jessica committed a new post from `/studio/` with a real token (commit dbb2413, one file added) and it rebuilt into the live site. The tray shows a link to the Actions page after a commit.
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
- [x] 2.2 PAT sign-in lives in the pending-changes tray (D14): validates `permissions.push`, keeps the token in sessionStorage, clears it on a 401. `auth/me` is answered by the browser API.
- [x] 2.3 The repo JSON loads into in-browser SQLite (sqlite-wasm) when `/studio/` starts, with a "Loading site data" message. The migrated empty DB is delivered as `studio-data/empty.db` (SPEC §9 Q6 answered).
- [x] 2.5 Content CRUD, drafts, publish and schedule run through EmDash's own route files in the browser (D15); e2e covers edit, create, schedule.
- [x] 2.7 Settings, schema, taxonomies, menus, widgets, bylines and SEO routes all come from the same route files (every sidebar page is covered by e2e).
- [x] 2.8 "Live in ~1–3 min" notice after a commit: the tray shows "The site rebuilds in a minute or two" with a link to the Actions runs. (Run polling is not done.)
- 2.4 (pluggable `apiFetch`) is done as 2b.1; 2.6 (save flow and conflicts) is 2b.5 and 2b.5b.

## Phase 3: Media, search, scheduling · est. 1–2 weeks
- [x] 3.1 Media upload: files go to an in-memory pending map, show in the tray as `Media` changes, persist in IndexedDB, and commit as blobs under `media/<key>`. Limit 10 MB per file (`MAX_UPLOAD`); the browser API reports `NOT_SUPPORTED` for signed uploads so the admin uses its direct-upload path. **Known gaps:** images already in the repo only display after the site is rebuilt; the editor's inline images keep `/_emdash/api/media/file/...` URLs inside the studio.
- [x] 3.2 Media library: the `media` table (`content/media.json`) is the index, so no separate `_index.json`. Deleting a committed item shows in the tray as a deleted file and is committed as a removal.
- [x] 3.3 Pagefind index in the build (`pagefind --site dist/client` after the URL rebase), search UI in `src/pages/search.astro`. Only pages marked `data-pagefind-body` (posts and pages) are indexed.
- [x] 3.4 Scheduled publishing: the studio schedules through EmDash's own handler (fixed a facade bug where the options object was passed as the clock). At build, `ghdash-pages publish-due` runs the core sweep (`publishDue` from the browser API bundle) on `data.db`, then writes `content/` back; `pages.yml` runs hourly (cron `17 * * * *`), skips the build unless `ghdash-pages due` says something is due, and commits the published state to `main`. Published time is the scheduled time. Tested with a real database (`test/publish-due.test.mjs`) and the studio (e2e). Released in `pages-v0.6.0`. **Not covered:** picking the date in the admin's schedule dialog is not automated, only the API call.

## Phase 4: Comments · est. 2–4 days
- [x] 4.1 giscus comments on posts (`GHDash-example`: `src/components/Giscus.astro`, config in `giscus.json`, mapped by post slug, shown only when the config is complete). The server-backed EmDash comment widgets are no longer rendered. **Needs from the site owner:** enable Discussions on the repo, install the giscus app, and commit `giscus.json` (see `giscus.example.json`). **Not done:** the `commentsEnabled` per-collection setting isn't read, and the admin's Comments screen still lists only server comments, which a static site never receives.
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
- [x] 6.1 CSP on `/studio/` (meta tag, no inline script) and a written review of token handling (SPEC §16). Demo branch `hardening-csp`.
- [ ] 6.1b Plain-language token explainer in the studio paste dialog.
- [x] 6.2 Template repo: e2e suite takes the base path from `BASE_PATH`, giscus example uses placeholders, `SETUP.md` covers template, Pages, token, giscus, scheduling. (Branch `template-repo` on the example repo; the "Template repository" checkbox in its settings is still to be ticked by the owner.)
- [~] 6.3 Tests: 27 Playwright tests in `GHDash-example/e2e/` (static pages, links, pagination, search, sitemap/robots/feed, giscus on/off, studio load, every sidebar page, edit/create/schedule, tray, commit, conflict merge, media upload) and 9 unit tests (`npm test`: tray logic, redirects, publish-due, giscus), both run in `.github/workflows/e2e.yml`. **Still to do:** JSON round trip as a CI test, a CI run with a real token (`test/live.mjs`).
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
- 2026-11-14: Pending-changes tray, commit and conflict flow built; 18 e2e and 6 unit tests pass locally.
- 2026-11-14: studio-experiment merged to GHDash-example main; /studio/ is live and checked.
- 2026-11-14: Jessica's real-token commit from /studio/ worked (dbb2413).
