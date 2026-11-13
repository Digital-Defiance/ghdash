#!/usr/bin/env bash
# Bundles EmDash's core API handlers for the browser. Run from the repo root after `pnpm build`.
# Needs: npm i --prefix ghpages-port/spike/browser-handlers @sqlite.org/sqlite-wasm@3.50.4-build1 path-browserify@1.0.1
set -euo pipefail
HERE="$PWD/ghpages-port/spike/browser-handlers"
ESB=$(ls -d node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/bin/esbuild)
"$ESB" "$HERE/entry.ts" --bundle --platform=browser --format=esm --outfile="$HERE/handlers.js" \
	--alias:node:async_hooks="$HERE/shims/async_hooks.js" \
	--alias:node:path="$HERE/node_modules/path-browserify" \
	--alias:virtual:emdash/config="$HERE/shims/virtual-config.js" \
	--alias:virtual:emdash/dialect="$HERE/shims/virtual-config.js" \
	--alias:astro:content="$HERE/shims/astro-content.js" \
	--alias:virtual:emdash/wait-until="$HERE/shims/virtual-config.js" \
	--alias:virtual:emdash/object-cache="$HERE/shims/virtual-config.js"
