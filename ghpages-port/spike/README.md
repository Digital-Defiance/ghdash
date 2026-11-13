# Phase 0 spike

Throwaway code that proves the risky parts of [../SPEC.md](../SPEC.md). Results are in SPEC §11 and TODO.md Phase 0.
All commands run from the repo root after `pnpm install && NODE_OPTIONS=--max-old-space-size=8192 pnpm build`.

| File | Proves |
|------|--------|
| `blog-static.patch` | The blog template builds with `output: "static"` once its four `[slug]` routes get `getStaticPaths()` (`git apply ghpages-port/spike/blog-static.patch`). |
| `db-json.mjs` | Lossless SQLite → JSON tree → SQLite round trip (`export <db> <outDir> <freshDb>`, `import <dir> <db>`). |
| `browser-handlers/` | EmDash's core API handlers bundle for the browser and run against the official SQLite WASM build (FTS5 included). |
| `github-commit.mjs` | Atomic multi-file commit with a PAT through the Git Data API, with conflict detection. `node --test ghpages-port/spike/github-commit.test.mjs` runs it against an in-memory fake of the API. |

## Reproduce

```bash
cd templates/blog
E="node ../../packages/core/dist/cli/index.mjs"
$E init && $E seed seed/seed.json                 # data.db with sample content
$E init -d /tmp/fresh.db                           # migrated empty DB, used as the import base
node ../../ghpages-port/spike/db-json.mjs export data.db /tmp/content /tmp/fresh.db
cp /tmp/fresh.db /tmp/rebuilt.db
node ../../ghpages-port/spike/db-json.mjs import /tmp/content /tmp/rebuilt.db
git apply ../../ghpages-port/spike/blog-static.patch
cp /tmp/rebuilt.db data.db && npx astro build      # static pages in dist/client

cd ../../ghpages-port/spike/browser-handlers
npm i @sqlite.org/sqlite-wasm@3.50.4-build1 path-browserify@1.0.1
(cd ../../.. && ghpages-port/spike/browser-handlers/build.sh)
node harness.mjs /tmp/fresh.db /tmp/content        # same WASM build browsers use
```

For the real-browser check, serve `browser-handlers/` over HTTP with `fresh.db` and a `content-bundle.json` (`{ "<table>": [rows...], "_ddl": [...] }`) beside `index.html`, then open the page.
