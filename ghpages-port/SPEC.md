# EmDash on GitHub Pages: Port Spec

Status: **Phase 0 spike done: the core approach works. See §11. Live GitHub commit test still pending.**
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

**Revisions:** `revisions.json` grows with every save. A single file will cause merge conflicts and bloat (§9 Q3).

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

## 11. Phase 0 spike results (2026-11-13)
The spike code is in `ghpages-port/spike/`, and `spike/README.md` has the reproduction steps. It was run on a clean clone of `main` at `c73c600`, using Node 22.23 and pnpm 11.9.

| # | Question | Result |
|---|----------|--------|
| 0.2 | Does the blog prerender with `output: "static"`? | ✅ Yes. With `getStaticPaths()` on 4 routes, it produced 18 HTML pages plus RSS (20 MB including assets). Live collections work at build time. |
| 0.3 | Is the JSON round trip lossless? | ✅ Yes. Export → import → export is identical after one normalising pass (the `options.revision` hash is recomputed by a trigger on first import). A site built from the reimported DB was byte-identical apart from the RSS build date. FTS search works after import. |
| 0.4 | Do the core handlers run in a browser? | ✅ Yes. List, create, publish and update content, update settings, list terms and menus, and create a collection (which creates `ec_projects`) all work in Node on the same WASM build. List, create and publish, plus an FTS query, also work in headless Chromium. |
| 0.5 | Can the browser make an atomic PAT commit? | 🟡 The code is written (`spike/github-commit.mjs`), and 3 tests pass against an in-memory fake API, covering text, binary and deletions in one commit, a stale head, and a mid-commit race. **Not yet run against real GitHub:** the spike environment had no GitHub credentials and its proxy blocked `api.github.com`. Needs a throwaway repo and a fine-grained PAT. |

Surprises:
- **Seed format is lossy** for this purpose (D11).
- `pnpm build` runs out of memory at the default heap size.
- Two dynamically imported virtual modules (`wait-until`, `object-cache`) only show up at runtime in the browser, so they need shims too.
