# EmDash on GitHub Pages: Port Spec

Status: **Phase 0 and Phase 1 done. Phase 2b: the real admin runs at `/studio/` on the live demo (https://digital-defiance.github.io/GHDash-example/studio/) with a pending-changes tray and one-commit saves; a real-token try-out is the next check. See §11–§14b.**
Last updated: 2026-11-13
Owner: Jessica
Companion file: [TODO.md](./TODO.md), the checkable work list. Update both files as work proceeds.

> **Handoff note for agents.** Read this whole file, then TODO.md, then `spike/README.md`. Decisions in §3 are settled, so don't reopen them without asking Jessica. Open questions are in §9. Whenever you finish or change something, update TODO.md and the "Status" and "Last updated" lines above. If a finding changes the design, record it in §10 (Decision log).

---

## 1. Goal

Run an EmDash site entirely on **GitHub Pages**, with no server, database or paid hosting:

- Content, schema and settings are stored as **JSON files in a public GitHub repo**, which is the source of truth.
- Editors use the EmDash **admin UI in the browser** and sign in with their own GitHub credentials. Each save is a **commit** to the repo.
- A **GitHub Action** builds the public site statically on every push and deploys it to Pages.

Target audience: open source projects and personal sites. **Everything in the repo is public, including drafts. This is accepted.**

## 2. Non-goals

- Private content, private drafts or private form submissions stored in the site repo.
- Anonymous commenting. Commenters need a GitHub account.
- Real-time co-editing, MCP, API tokens, or EmDash's own users, roles and passkey auth.
- Staying a drop-in upstream EmDash. This is a fork or an adapter, and we try to keep the diff against upstream small (§8).

## 3. Settled decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | The store is JSON in a public repo, and git history serves as revisions. | No server. Drafts being public is fine for OSS sites. |
| D2 | The public site is a static Astro build run in a GitHub Action, deployed to Pages. | Pages only serves static files. |
| D3 | At build time, the JSON is loaded into SQLite and the existing EmDash queries and templates run against it. | Reuses the loader, templates and query code unchanged. |
| D4 | Admin auth uses a **fine-grained PAT** pasted by the user, scoped to one repo with Contents read/write. | GitHub's OAuth token endpoints, device flow included, don't allow CORS, so OAuth would need a proxy. OAuth with a Worker proxy can be added later as an option. |
| D5 | Admin saves are atomic multi-file commits through the **Git Data API** (trees and commits), with optimistic concurrency on the branch head SHA. | Several files change per save, and this stops edits from silently overwriting each other. |
| D6 | Comments go through GitHub and **require a GitHub account**. Use giscus (Discussions) first. An issue-triggered Action that commits comments as JSON is an option for later. | No server needed. Jessica accepted the account requirement. |
| D7 | Plugins are split. UI and before-hooks run in the browser admin. After-hooks, cron and anything needing secrets run in the build Action. Public plugin HTTP routes are not supported. | Pages has no runtime. Secrets can't go in a public repo. |
| D8 | Plugin secrets live in **GitHub Actions secrets**, never in repo JSON. | Public repo. |
| D9 | Search uses **Pagefind**, generated at build time. | FTS5 queries need a server at request time. |
| D10 | Scheduled publishing is a cron-triggered Action that flips due entries and rebuilds. | No cron on Pages. |
| D11 | The repo store is **table-shaped JSON**: one file per row for `ec_*` tables, one file per small system table, and `_ddl.json` for objects that migrations don't create. **The seed format is not used.** | The spike showed this round-trips losslessly. Re-applying a seed gives new IDs and resets `published_at`/`created_at` to the time of the seed, so dates would change on every build. |
| D13 | Fork tarballs are distributed as **GitHub release assets** on `Digital-Defiance/ghdash`, built by `.github/workflows/pages-tarballs.yml` (tags `pages-v*`). Sites depend on the release asset URL through an npm `overrides` entry. No binaries are committed to site repos. | Keeps site history small and gives every build a versioned, public URL. Jessica's suggestion. |
| D14 | The admin **accumulates edits as pending changes** instead of committing on every save. A toolbar icon with a count opens a dropdown listing each pending change (entry or setting, with its type: new, edited, deleted). From it the editor can review a diff, discard one change, or **Commit** everything as one commit with a message. Pending changes live in the in-browser database and are persisted to IndexedDB so a reload doesn't lose them. | Matches how git works, gives one meaningful commit per editing session, and turns every settings screen into a batch edit. Jessica's suggestion. |
| D15 | The in-browser API **runs EmDash's own route files**, not a hand-written copy. `browser-api/gen-routes.mjs` lists every file under `packages/core/src/astro/routes/api`, and `router.ts` matches a request path to one, then calls its `GET`/`POST`/... with an Astro-like context: `params`, `request`, `url`, `locals.user` (an admin), and `locals.emdash`, a facade whose `db` is the sqlite-wasm Kysely and whose `handleXxx` methods call the core handlers. Routes are esbuild chunks loaded on demand. | One implementation to maintain, and permission checks, validation and response shapes stay identical to the server. A first hand-written router covered about ten routes; this covers 234 with less code. Closes §9 Q7. |
| D12 | The admin data layer uses **Option A**: the core handlers run in the browser on the official `@sqlite.org/sqlite-wasm` build. | The spike showed the handlers bundle with five small shims, and that content, settings, taxonomy, menu and schema handlers work on the WASM build (content was also checked in headless Chromium). sql.js was rejected because it has no FTS5. |

## 4. Architecture

```
            ┌──────────────── public GitHub repo ────────────────┐
            │  content/  (JSON source of truth)                   │
            │  media/    (uploaded files)                         │
            │  site/     (Astro project: EmDash + template)       │
            └───────▲───────────────────────────────┬────────────┘
   commits via      │                               │ push / cron / issue
   Git Data API     │                               ▼
┌───────────────────┴──────┐            ┌────────────────────────────┐
│ Browser admin (on Pages) │            │ GitHub Action              │
│  EmDash admin SPA        │            │ 1. JSON → SQLite (Node)    │
│  apiFetch → local router │            │ 2. after-hooks / cron      │
│  in-browser SQLite (wasm)│            │ 3. astro build (static)    │
│  PAT in sessionStorage   │            │ 4. pagefind index          │
└──────────────────────────┘            │ 5. deploy to Pages         │
                                        └────────────────────────────┘
```

### 4.1 Repo layout (proven in the spike, D11)

```
content/
  _ddl.json                     # CREATE statements for ec_* tables, their indexes, FTS tables and triggers
  ec_<collection>/<id>.json     # one file per content row, all columns, keys sorted
  _emdash_collections.json      # schema
  _emdash_fields.json
  options.json                  # site settings (site:title, site:tagline, ...)
  revisions.json
  taxonomies.json, content_taxonomies.json, _emdash_taxonomy_defs.json, ...
  _emdash_menus.json, _emdash_menu_items.json, _emdash_widget_areas.json, _emdash_widgets.json,
  _emdash_bylines.json, _emdash_content_bylines.json, _emdash_sections.json, ...
media/
  <yyyy>/<mm>/<file>            # plus the media table rows in content/
```

Rows are written as pretty-printed JSON with sorted keys, ordered by primary key. The blog seed exports to 25 files (132 KB). The following are **not exported**, and are rebuilt or dropped: FTS shadow tables (`_emdash_fts_*_data|idx|content|docsize|config`), `_emdash_migrations*`, `*_lock` tables, media-usage bookkeeping, rate limits, the 404 log, and every auth, session, token, OAuth and room table. The exclusion list is `SKIP` in `spike/db-json.mjs`. On import, the order is: migrated empty DB, then `_ddl` tables, then triggers (so the FTS triggers index rows as they load), then rows, then indexes.

**Revisions:** one file per row under `revisions/` (decided: kept, split per row; an older single `revisions.json` is still read).

### 4.2 Starting points in the codebase

| Need | Existing code |
|------|---------------|
| DB ↔ JSON | `ghpages-port/spike/db-json.mjs` (proven). `generateSnapshot` and the seed CLI were considered: snapshot has no per-row layout, and seed is lossy (D11). |
| Migrated empty DB | `emdash init -d <path>` (CLI in `packages/core/dist/cli`). The schema is at migration 097. |
| Site reads content | `packages/core/src/loader.ts` (Astro live loader) and `packages/core/src/query.ts` (`getEmDashCollection`, `getEmDashEntry`) |
| Admin network layer | `packages/admin/src/lib/api/client.ts` (`apiFetch`, `API_BASE = "/_emdash/api"`), the single interception point |
| Business logic | `packages/core/src/api/handlers/*.ts`. Handlers take `db: Kysely<Database>` and return `ApiResult<T>`. |
| Routes | `packages/core/src/astro/routes/api/**`, about 236 files. The integration forces `prerender: false` in `packages/core/src/astro/integration/index.ts`. |
| SQLite dialect | `emdash/db/sqlite`, and libSQL |
| Plugins | `packages/core/src/plugins/` (manager, hooks, cron, sandbox) and `packages/plugins/*` |

## 5. Components

### 5.1 Build pipeline (GitHub Action)
1. Check out the repo, then `pnpm install`.
2. `json-to-sqlite`: create a fresh SQLite DB, run EmDash migrations, then insert rows from `content/**`. Reuse snapshot and seed logic where possible.
3. Run after-hooks and cron for changed entries (§5.4), using Actions secrets.
4. `astro build` with `output: "static"`. **Proven:** live collections resolve during prerender, and the site rebuilt from JSON was byte-identical to the original (only `rss.xml`'s `lastBuildDate` differed). Templates need these changes:
   - `getStaticPaths()` on every dynamic route. See `spike/blog-static.patch` for posts, pages, category and tag.
   - Pagination via `?cursor=` becomes path-based pages (`/posts/page/2/`), because query strings don't render statically.
   - `search.astro` is server-only and is replaced by Pagefind (D9).
   - The `Comments` and `CommentForm` components from `emdash/ui/comments` are replaced by giscus (D6).
   - Build memory: `pnpm build` of the monorepo needs `NODE_OPTIONS=--max-old-space-size=8192`. The blog build alone takes about 20 s.
5. Media: copy `media/` into the output. Astro image optimisation runs at build.
6. `pagefind --site dist`.
7. Emit `redirects.json` as static HTML redirect stubs.
8. Deploy with `actions/deploy-pages`.
Triggers: push to the main branch, `schedule` (scheduled publishing), and `issues` / `discussion` events if D6's Action option is used.

### 5.2 Browser admin
- Built as a separate static bundle served under `/admin/` on the same Pages site.
- **Data layer: Option A (D12, proven).** Load repo JSON into `@sqlite.org/sqlite-wasm`, which includes FTS5, and run the core handlers against it. Kysely's stock `SqliteDialect` works through about 20 lines of better-sqlite3-shaped adapter (see `spike/browser-handlers/harness.mjs`).
  - Bundle: esbuild with `--platform=browser` gives 1.1 MB, or 258 KB gzipped, for the content, schema, settings, menus, taxonomies, bylines, sections, SEO, revision, media and redirects handlers.
  - The only non-browser imports are shimmed by aliases (`spike/browser-handlers/build.sh`): `node:async_hooks` (a single-store `AsyncLocalStorage`), `node:path` (`path-browserify`), `astro:content`, and `virtual:emdash/{config,dialect,wait-until,object-cache}`.
  - The migrated empty DB loads with `sqlite3_deserialize`. Its WAL header bytes (offsets 18–19) must be set to 1 first.
  - `apiFetch` is redirected to a local router that maps `/_emdash/api/...` paths to handlers. On save, the changed rows are serialised to JSON files and committed (D5).
- **Option B (fallback, not needed):** a slim local API for MVP endpoints only.
- Handlers that need a session or user get a fixed "repo collaborator" user with full permissions. GitHub repo permissions are the real access control.
- Auth: a paste-your-PAT screen. Validate the PAT with `GET /repos/{owner}/{repo}` and check `permissions.push`. Keep it in `sessionStorage` by default, with "remember me" opting into `localStorage`. Never commit it.
- Conflict handling: if the branch head moved, re-fetch the changed files, show a conflict notice, and offer to reload or force.
- Show "Published, live in ~1–3 min" after a commit. Optionally poll the Actions run status.

### 5.3 Media
- Uploads are committed under `media/` through the Git Data API, as blobs then a tree.
- Limits: 100 MB per file (hard), about 1 GB per repo (soft). Warn above 25 MB. Git LFS is **not** served by Pages, so don't use it.
- The image-transform endpoint is replaced by build-time Astro image processing.

### 5.4 Plugins
| Plugin part | Where it runs |
|-------------|---------------|
| Admin UI (field widgets, admin pages, Portable Text blocks) | Browser admin |
| `content:before*` and `media:beforeUpload` hooks (validation, transforms) | Browser admin, before the commit |
| `content:after*` and `media:afterUpload` hooks (webhooks, syndication) | Build Action, on entries changed in the pushed commit |
| `page:metadata` and `page:fragments` | Build, during the static render |
| `comment:*` hooks | Build Action, only with D6's Action option |
| Cron | Scheduled Action |
| Settings without secrets | `content/plugins/<id>/settings.json` |
| Secret settings | Actions secrets, exposed to Action-side hooks only |
| Public HTTP routes | **Not supported.** Document this per plugin. |
| Sandboxed and marketplace plugins | Need a new runner (Web Worker in the browser, Node in the Action). Installing one commits plugin code. Planned for phase 5. |

Expected fit for bundled plugins: `color`, `field-kit` and `embeds` should port fully. `webhook-notifier`, `atproto` and `audit-log` should work through Action-side hooks. `forms` and `ai-search` lose their public routes. Forms submissions must **not** be stored in the public repo.

### 5.5 Comments
- MVP: giscus embed in templates for collections with `commentsEnabled`.
- Later: an issue-form link plus an `issues: opened` Action that runs the comment hooks, commits `content/comments/<collection>/<entry>.json` and rebuilds.

## 6. Feature matrix

| Feature | Status on Pages |
|---------|-----------------|
| Posts, pages, custom collections, fields | ✅ |
| Drafts and revisions | ✅ public, with git history as revisions |
| Taxonomies, menus, widgets, sections, bylines, SEO | ✅ |
| Media | ✅ within GitHub's size limits |
| Search | 🔁 Pagefind |
| Scheduled publishing | 🔁 cron Action (granularity limited by the schedule) |
| Redirects | 🔁 static stubs (no 301 status) |
| Sitemap and robots | ✅ build time |
| Comments | 🔁 giscus or issue Action, GitHub account needed |
| Forms | ⚠️ needs an external receiver, submissions kept out of the repo |
| Users, roles, passkeys, magic links | ❌ replaced by GitHub repo permissions |
| API tokens, MCP, OAuth server | ❌ |
| Real-time co-editing, entry locks | ❌ (concurrency is handled by commit SHA) |
| Visual editing and preview | 🔁 possible in the browser admin, later |
| Plugin public routes | ❌ |

## 7. Security notes
- The PAT lives in the browser. Recommend a fine-grained PAT scoped to one repo with Contents read/write only, and a short expiry.
- Never write secrets to `content/**`. Strip secret-flagged plugin settings and `_emdash_*` auth tables during export.
- XSS in the admin would leak the PAT, so keep the admin CSP strict.

## 8. Fork strategy
Prefer an **adapter** shape over invasive edits: a new package (for example `packages/github-pages`) that provides the JSON↔SQLite tooling, the Action, the browser router and the PAT auth. Upstream changes should be limited to small, additive hooks, such as a static-build path in `query.ts` and a pluggable fetch transport in `apiFetch`. This keeps rebases on upstream EmDash manageable.

## 9. Open questions
1. ~~Do Astro live collections work during a static build?~~ Yes (§11).
2. ~~Option A or B for the admin data layer?~~ Option A (D12).
3. Revisions: keep the `revisions` rows in JSON (split per entry, e.g. `revisions/<entry-id>.json`), or rely on git history only?
6. Where does the browser get the migrated empty DB? Either ship `fresh.db` (~1.5 MB) as a build artifact, or bundle the Kysely migrator and run migrations in the browser (untested).
7. The route layer: write a local router that calls the handlers directly, or reuse the Astro route files with a fake `APIContext`? The route files add validation (zod `parseBody`) and permission checks we'd like to keep.
4. One repo for the site and content, or a separate content repo?
5. Custom domains and base paths: project Pages sites live under `/<repo>/`, so check base-path support.

## 10. Decision log
- 2026-11-13: Feasibility assessed. D1–D10 agreed with Jessica. Public drafts are OK. A GitHub account is required for comments.
- 2026-11-13: Phase 0 spike approved and run. D11 (table-shaped JSON, not seed) and D12 (Option A on sqlite-wasm) were added from the results.
- 2026-11-13: The live PAT commit test passed against `Digital-Defiance/GHDash-example`, which is now the demo and test repo for later phases. Phase 0 is complete.

## 11. Phase 0 spike results (2026-11-13)
The spike code is in `ghpages-port/spike/`, and `spike/README.md` has the reproduction steps. It was run on a clean clone of `main` at `c73c600`, using Node 22.23 and pnpm 11.9.

| # | Question | Result |
|---|----------|--------|
| 0.2 | Does the blog prerender with `output: "static"`? | ✅ Yes. With `getStaticPaths()` on 4 routes, it produced 18 HTML pages plus RSS (20 MB including assets). Live collections work at build time. |
| 0.3 | Is the JSON round trip lossless? | ✅ Yes. Export → import → export is identical after one normalising pass (the `options.revision` hash is recomputed by a trigger on first import). A site built from the reimported DB was byte-identical apart from the RSS build date. FTS search works after import. |
| 0.4 | Do the core handlers run in a browser? | ✅ Yes. List, create, publish and update content, update settings, list terms and menus, and create a collection (which creates `ec_projects`) all work in Node on the same WASM build. List, create and publish, plus an FTS query, also work in headless Chromium. |
| 0.5 | Can the browser make an atomic PAT commit? | ✅ Yes. 3 tests pass against an in-memory fake API. Jessica also ran it live with a fine-grained PAT against `Digital-Defiance/GHDash-example` on 2026-11-13, using `spike/live-commit-test.mjs` on branch `spike/live-commit-test`: 2 JSON files and 1 PNG landed in one commit, a stale head was reported as a conflict, and a deletion commit worked. |

Surprises:
- **Seed format is lossy** for this purpose (D11).
- `pnpm build` runs out of memory at the default heap size.
- Two dynamically imported virtual modules (`wait-until`, `object-cache`) only show up at runtime in the browser, so they need shims too.

## 12. Phase 1 notes (2026-11-13)
- The demo site is `Digital-Defiance/GHDash-example`. It installs the **published `emdash@1.5.0`** from npm, so nothing is forked yet. The blog template was copied in with the `getStaticPaths()` patch from the spike.
- `npm run build` does: `emdash init` (migrated empty DB) → `scripts/db-json.mjs import content data.db` → `astro build` → `scripts/rebase-urls.mjs dist/client`.
- **Base path:** Astro prefixes its own assets, but the template hardcodes root-absolute links like `href="/posts/x"`. `scripts/rebase-urls.mjs` rewrites those in the built output. A cleaner fix is for templates to use `import.meta.env.BASE_URL` (TODO 1.4a).
- **Dependabot** opened a run on the repo as soon as `package.json` landed. It is harmless but may open PRs.
- `content/options.json` is committed in its normalised form, so the first import doesn't produce a diff.
- **Font fetch flake:** `astro build` downloads Google font files, and one CI run failed on a `CannotFetchFontFile` error before passing on rerun (TODO 1.7).
- **First deploy:** live 2026-11-13 after Pages was enabled. The Action deploys `dist/client` only.

## 13. Phase 2a: minimal editor (2026-11-13)
- Shipped as a stepping stone before the real admin (§5.2): `GHDash-example/public/admin/index.html`, one dependency-free file. It reads `content/ec_posts` and `content/ec_pages` through the GitHub contents API at a pinned head SHA, and saves with the same atomic Git Data API flow as `spike/github-commit.mjs`.
- It edits only `title`, `excerpt`, `content` (as plain paragraphs), `status`, `published_at`, `updated_at` and `version` on the row. It does not touch `revisions.json`, bylines, taxonomies or images. That is safe for rendering because published pages read the `ec_*` columns directly (checked with a rebuild), but it means edits made here leave no EmDash revision history, only git history.
- Paragraph-only round trip: a body is editable only if every block is a plain `normal` paragraph with one unformatted span. Anything else is locked rather than flattened.
- The real admin (2b) needs `ADMIN_BASEPATH` and `API_BASE` made configurable plus a browser transport. See TODO Phase 2.

## 14. Phase 2b: running the real admin (2026-11-13)
- **Paths are configurable in the fork.** `packages/admin/src/lib/paths.ts` exports `ADMIN_BASE`, `API_BASE` and `customFetch`, read once from `globalThis.__EMDASH_PATHS__`, so the config must be set before the admin bundle loads (the demo does it in an inline `<script>`). `apiFetch` rewrites the 54 hardcoded `/_emdash/api` literals to `apiBase`, so they didn't need touching one by one.
- **Distribution:** the demo vendors a tarball of the fork's admin, built with `pnpm pack`, and pins it with npm `overrides`. `emdash` core stays the published 1.5.0 for now. Core changes later will need its tarball too (6 MB).
- **Boot sequence observed:** the admin requests `GET /_api/manifest` and `GET /_api/auth/me` first. `manifest` is produced server-side by `emdash.getManifest()` plus branding, timezone, auth mode and plugin state. `auth/me` returns the current user. The browser router has to produce both from the in-browser database.
- **What the router can reuse:** the handlers in `packages/core/src/api/handlers/*` (proven in the spike). The route files add zod validation, permissions and the `{ data }` envelope, which the router must reproduce or reuse (SPEC §9 Q7).
- **Known limits to handle:** Pages has no SPA fallback, so deep links need a shim (2b.6). The `emdash` package doesn't export the handlers, so an additive export is needed.

## 14a. Browser API results (2026-11-14)
- `ghpages-port/browser-api/`: `router.ts`, `gen-routes.mjs`, `load-db.js` (opens sqlite-wasm from `_ddl.json` plus the JSON rows over an empty migrated DB), `make-empty-db.mjs`, `build.sh`, `test.mjs`.
- Build: `node gen-routes.mjs '^dev/'` then `bash build.sh`. esbuild with `--splitting`; `node:*`, `astro:*` and `virtual:*` are external, `node:module` is a shim whose `require()` returns inert stand-ins for `crypto`, `util` and `stream`, and `Buffer` comes from the `buffer` package. Output is about 22 MB in 600 lazy chunks; a visit loads only what its routes need.
- In headless Chromium against a local build, the real admin loads with real data, every sidebar page renders (dashboard, content lists, editor, taxonomies, menus, content types, plugins, settings, bylines, redirects, widgets, sections), and editing a post shows "Saved" and the edit is there on reopening.
- Known gaps: users and passkey routes are meaningless on a static site; media upload and settings saves are untested; the `media-usage` activation check logs a harmless error; the entry-lock routes write to a lock table, which the pending-changes diff must ignore; deep links still 404 on a plain static server (2b.6). The demo does not yet fetch the chunks from a release asset (see TODO 2b.4).
- Draft semantics are EmDash's own: saving a published post writes a draft revision, so the list keeps the live title until the change is published.

## 14b. Tray results (2026-11-14)
- Diffing is at file granularity, as D11 lays the repo out: an edited post is one `ec_*/<id>.json`; settings, menus and the like are one file per table. The snapshot of a freshly loaded DB equals `content/` byte for byte, so there are no phantom changes. Transient tables (entry locks, rate limits, FTS, sessions) are skipped; the lock table's name was `_emdash_entry_locks`, which the first skip rule missed, and the same fix went into `db-json.mjs`.
- The tray sits in the admin header through a `HeaderExtras` slot in the fork (additive; unused by default). When the tray changes data behind the API (discard, merge, restore), the studio resets the admin's query cache through `onQueryClient` and remounts it.
- Commit uses the Git Data API with an expected head. On a 422 or a moved head the tray keeps the changes and offers "Update my copy".
- Not done: schema-change merge and discard, media, and a way to see a diff of one row's fields.

## 15. Pending-changes tray and release tarballs (2026-11-13)
**Pending changes (D14).** The in-browser database is the working copy and the repo JSON loaded at start is the baseline.
- A change is any row that differs from the baseline: added, modified or removed. The list is computed by diffing the two, so it needs no change tracking in the handlers. Each item is labelled from the row (a post's title, a setting's name).
- The tray is a toolbar icon with a count badge. The dropdown lists the changes and offers: view diff, discard this change, discard all, and **Commit** (message box prefilled, for example "Edit 2 posts, 1 setting").
- Commit writes only the changed files in one commit through `github-commit.mjs`, using the baseline head SHA for conflict detection. After a conflict the tray keeps the changes and offers to rebase them: reload the new baseline, then re-apply the changed rows that don't clash.
- Persistence: baseline head SHA plus the list of changed rows in IndexedDB, restored on load only if the baseline head is unchanged.
- The minimal editor (§13) still commits per save. It could adopt the tray later.
- Settings are rows in `options.json`, so they are covered by the same mechanism.

**Release tarballs (D13).** The workflow builds the monorepo with an 8 GB heap, packs `admin` and `core`, and creates or updates a release for the tag. It was pushed on `spike/ghpages-phase0`, but GitHub only allows manual dispatch for workflows on the default branch, so the first run needs a `pages-v*` tag push. This session's git proxy refused tag pushes.

**Status of D13:** done. `pages-v0.1.0` carries the admin and core tarballs, and the demo's `studio-experiment` branch installs the admin from `https://github.com/Digital-Defiance/ghdash/releases/download/pages-v0.1.0/emdash-cms-admin-1.5.0.tgz` through npm `overrides`. The release was started by pushing the tag from a local clone.

## 14c. Media results (2026-11-14)

- Storage backend in the browser API: `upload` keeps bytes in a `pendingMedia` map (shared with the host so it can persist them), `download` reads the map first and then `<site>/media/<key>`, `getPublicUrl` is `<site>/media/<key>`, `getSignedUploadUrl` throws `NOT_SUPPORTED` so the core route falls back to its direct-upload route.
- The admin's direct upload used a raw `fetch` for the PUT; it now goes through `apiFetch` when the upload URL is a relative path, so a host-provided `fetch` sees it. Absolute (signed) URLs are unchanged.
- Tray: an upload is `@media/<key>` in the change list (label is the filename) and replaces the `media.json` entry while file changes exist. Commit sends `media/<key>` as a blob; a deleted committed row sends `media/<key>: null`. Discard removes the pending bytes and the row, or restores a deleted row.
- Build: `scripts/copy-media.mjs` copies `media/` to `public/media/`, and `rebase-urls.mjs` rewrites media URLs in built HTML and XML.
- Covered by two e2e tests (upload, reload, commit bytes; discard).

## 16. Security review: token and studio page (2026-11-14)

What the studio holds and who can reach it:

- **The token** lives in `sessionStorage` under `ghdash-token` and is sent only to `https://api.github.com` as a Bearer header. It dies with the tab. A 401 clears it.
- **Pending changes** (including uploaded files) live in IndexedDB, keyed by `<repo>#<branch>`. They persist across tabs and restarts and are discarded if the branch head moved.
- **Shared origin.** Project sites on `<owner>.github.io` all share one origin. Any page on a sibling repo's site could read `sessionStorage` (same tab) and IndexedDB. Use a fine-grained token limited to the one repository with only Contents read and write, so a leak is bounded to that repository. A custom domain per site removes the sharing.
- **Content Security Policy.** `/studio/` ships a CSP meta tag: scripts only from the site itself (plus WebAssembly), network only to the site and `api.github.com`, no objects, no foreign base or form targets. The boot script moved to `studio/paths.js` so no inline script is needed. The e2e suite fails on any CSP violation in the studio. A meta tag cannot set `frame-ancestors`, so clickjacking protection is not available on Pages.
- **Not covered:** an XSS in the admin itself could still use the token while the tab is open (the CSP stops it sending the token elsewhere, not from calling the GitHub API). Post bodies render through EmDash's Portable Text, which does not emit raw HTML.

The paste dialog has a "What token do I need?" section that gives the creation link, the single repository, Contents read and write, and how the token is kept.

## 17. Pulling in upstream EmDash (2026-11-14)

**What we change in upstream code.** Only 15 files outside `ghpages-port/`, all in `packages/admin/src` (`git diff --name-only origin/main HEAD -- packages`): `App.tsx`, `router.tsx`, `lib/paths.ts` (new, the one place that knows about base paths), `lib/url.ts`, `lib/plugin-links.ts`, `lib/api/client.ts`, `lib/api/media.ts`, and eight components that built `/_emdash/admin` links by hand (`AdminCommandPalette`, `DeviceAuthorizePage`, `Header`, `InviteAcceptPage`, `LoginPage`, `SetupWizard`, `SignupPage`, `WordPressImport`). Core, auth and the route files are untouched: the browser API loads them as they are.

**Rule for new patches.** Keep them additive and small. Anything that builds a URL goes through `lib/paths.ts`. Anything new for the port goes under `ghpages-port/` or `.github/workflows/pages-tarballs.yml`.

**Procedure for each upstream release**
1. `git remote add upstream <the upstream EmDash repository URL>` (once), then `git fetch upstream`.
2. On a branch off `spike/ghpages-phase0`, run `git rebase upstream/main` (or merge, if the history is long). Conflicts are most likely in the 15 files above; keep upstream's change and re-apply the `paths.ts` call.
3. `grep -rn "/_emdash/admin\|/_emdash/api" packages/admin/src` and route any new hand-built URL through `lib/paths.ts`.
4. `pnpm build`, `pnpm typecheck`, `pnpm lint:quick`, then the adapter tests (`cd ghpages-port/adapter && npm test`).
5. Rebuild the browser API (`ghpages-port/browser-api`) and check the router still covers every route file: the studio e2e test "every sidebar page loads without API errors" fails if a new route needs something the facade lacks.
6. Check upstream's new migrations: they run on the freshly initialised database at build time and in `empty.db`, so they apply to existing sites without changing `content/`. A migration that changes `ec_*` tables needs `_ddl.json` regenerated (`ghdash-pages export-content`), which a normal build does.
7. Tag `pages-v*`, point the demo at it (`npm install`), and wait for the demo's CI to pass before merging.

**Version names.** The tarballs are named after the upstream package versions (`emdash-1.5.0.tgz`). When upstream bumps the version the asset names change, so update the `overrides` URLs in the demo's `package.json` and in the template instructions in the same change.

**Cadence.** Rebase on upstream minor releases, or sooner for a security fix. Between releases, nothing needs doing: the demo pins a release.
