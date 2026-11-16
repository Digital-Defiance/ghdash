#!/usr/bin/env bash
# Bundles EmDash's core API handlers for the browser. Run from the repo root after `pnpm build`.
# Needs: npm i --prefix gitpages-port/spike/browser-handlers @sqlite.org/sqlite-wasm@3.50.4-build1 path-browserify@1.0.1
set -euo pipefail
HERE="$PWD/gitpages-port/browser-api"
ESB=$(ls -d node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/bin/esbuild)
rm -rf "$HERE/dist"
"$ESB" "$HERE/entry.ts" --bundle --splitting --platform=browser --format=esm --alias:node:module="$HERE/shims/node-module.js" --inject:"$HERE/shims/buffer-inject.js" --alias:buffer="$PWD/gitpages-port/spike/browser-handlers/node_modules/buffer" --external:node:* --external:astro:* --external:virtual:* --external:cloudflare:* --outdir="$HERE/dist" --chunk-names="chunks/[name]-[hash]" \
	--alias:node:async_hooks="$PWD/gitpages-port/spike/browser-handlers/shims/async_hooks.js" \
	--alias:node:path="$PWD/gitpages-port/spike/browser-handlers/node_modules/path-browserify" \
	--alias:virtual:emdash/config="$PWD/gitpages-port/spike/browser-handlers/shims/virtual-config.js" \
	--alias:virtual:emdash/dialect="$PWD/gitpages-port/spike/browser-handlers/shims/virtual-config.js" \
	--alias:astro:content="$PWD/gitpages-port/spike/browser-handlers/shims/astro-content.js" \
	--alias:virtual:emdash/wait-until="$PWD/gitpages-port/spike/browser-handlers/shims/virtual-config.js" \
	--alias:virtual:emdash/object-cache="$PWD/gitpages-port/spike/browser-handlers/shims/virtual-config.js"
