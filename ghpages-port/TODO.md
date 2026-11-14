# EmDash on GitHub Pages: TODO

Read [SPEC.md](./SPEC.md) first. Tick items as they're done, add notes inline (`→ note`), and update SPEC.md's status line and decision log when anything changes.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (say why)

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
- [x] 1.3 GitHub Action (`GHDash-example/.github/workflows/pages.yml`) deployed the site: https://digital-defiance.github.io/GHDash-example/. Home, a post, nav and post links were checked through a page fetch. Not yet checked by eye: styling and fonts. The first run failed fetching a Google font file and passed on rerun (see 1.7).
- [x] 1.4 Base-path support for project sites (`/<repo>/`): `astro.config.mjs` reads `BASE_PATH`/`SITE_URL`, and `scripts/rebase-urls.mjs` prefixes the template's root-absolute links in built HTML/XML. Verified in a local build.
- [~] 1.4a Template changes: `getStaticPaths()` on the 4 dynamic routes is done (in `GHDash-example`). **Still to do:** path-based pagination instead of `?cursor=` (lists show page 1 only), and a replacement for `/search`.
- [ ] 1.4b Split `revisions.json` per entry, or drop it (SPEC §9 Q3).
- [x] 1.7 Font downloads: the workflow now retries the build up to 3 times, so a transient Google font fetch failure no longer fails the deploy.
- [ ] 1.5 Copy media and optimise images at build time.
- [ ] 1.6 Sitemap, robots and static redirect stubs.

## Phase 2: Browser admin with PAT editing · est. 2–3 weeks
**2a (minimal editor) is done; 2b (the real EmDash admin) has not started.** 2a is `GHDash-example/public/admin/index.html`: one static file, PAT sign-in, list/create/edit posts and pages (title, excerpt, plain-paragraph body, status), one commit per save, refuses to save if the branch moved. Tested in headless Chromium against a fake GitHub API, and the JSON it wrote rebuilt into the right pages. Bodies with headings, links, images or lists are read-only there so they can't be damaged.
- [x] 2a.1 PAT sign-in with push-permission check, session-storage only.
- [x] 2a.2 Create and edit posts and pages as single commits, with a stale-head conflict check.
- [ ] 2a.3 Try it against the real repo from a real browser (Jessica), and show an Actions status link after saving.
**2b notes from reading the admin:** `packages/admin` hardcodes `ADMIN_BASEPATH = "/_emdash/admin"` (App.tsx) and `API_BASE = "/_emdash/api"` (lib/api/client.ts). Serving it under `/<repo>/admin/` needs both made configurable, and a fetch transport that calls the browser handlers (spike/browser-handlers) instead of the network. Those are small upstream changes but touch the admin's boot calls (manifest, current user, setup status), which still need mapping.
- [ ] 2.1 Admin static bundle served at `/admin/`.
- [ ] 2.2 PAT sign-in screen: validate with `permissions.push`, sessionStorage, optional remember-me.
- [ ] 2.3 Load repo JSON into in-browser SQLite on admin start, with a progress indicator (start from `spike/browser-handlers/`). Decide how the migrated empty DB is delivered (SPEC §9 Q6).
- [ ] 2.4 Make the `apiFetch` transport pluggable and route it to the local router (SPEC §9 Q7: reuse the route files or call handlers directly).
- [ ] 2.5 Local routes for content CRUD, drafts and publish for posts and pages.
- [ ] 2.6 Save flow: changed rows → JSON files → atomic commit, plus conflict UI.
- [ ] 2.7 Settings, schema (collections and fields), taxonomies, menus, widgets, bylines and SEO routes.
- [ ] 2.8 "Live in ~1–3 min" notice, with optional Actions run polling.

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
- [ ] 6.3 Tests: JSON round trip, commit/conflict flow, static build smoke test.
- [ ] 6.4 Rebase plan and checklist for pulling in upstream EmDash.

## Log
- 2026-11-13: Spec and TODO created after the feasibility review.
- 2026-11-13: Phase 0 spike run. 0.2–0.4 pass, and 0.5 passes against a fake API with the live run pending. D11 and D12 added to SPEC.
- 2026-11-13: Live commit test passed. Phase 0 complete. The spike is on branch `spike/ghpages-phase0`.
- 2026-11-13: Phase 1 first cut pushed to `Digital-Defiance/GHDash-example` (main). Local clean-clone build gives 18 pages with the right base path. The Pages deploy waits on enabling Pages in repo settings.
- 2026-11-13: Pages enabled by Jessica and the first successful deploy is live. A font-fetch flake needed one rerun.
- 2026-11-13: Minimal editor (2a) built and deployed to GHDash-example `/admin/`. Retry added for font flake.
