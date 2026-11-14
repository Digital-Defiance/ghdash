#!/usr/bin/env bash
# Bundles EmDash's core API handlers for the browser. Run from the repo root after `pnpm build`.
# Needs: npm i --prefix ghpages-port/spike/browser-handlers @sqlite.org/sqlite-wasm@3.50.4-build1 path-browserify@1.0.1
set -euo pipefail
HERE="$PWD/ghpages-port/browser-api"
ESB=$(ls -d node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/bin/esbuild)
"$ESB" "$HERE/entry.ts" --bundle --platform=browser --format=esm --outfile="$HERE/api.js" \
	--alias:node:async_hooks="$PWD/ghpages-port/spike/browser-handlers/shims/async_hooks.js" \
	--alias:node:path="$PWD/ghpages-port/spike/browser-handlers/node_modules/path-browserify" \
	--alias:virtual:emdash/config="$PWD/ghpages-port/spike/browser-handlers/shims/virtual-config.js" \
	--alias:virtual:emdash/dialect="$PWD/ghpages-port/spike/browser-handlers/shims/virtual-config.js" \
	--alias:astro:content="$PWD/ghpages-port/spike/browser-handlers/shims/astro-content.js" \
	--alias:virtual:emdash/wait-until="$PWD/ghpages-port/spike/browser-handlers/shims/virtual-config.js" \
	--alias:virtual:emdash/object-cache="$PWD/ghpages-port/spike/browser-handlers/shims/virtual-config.js"
