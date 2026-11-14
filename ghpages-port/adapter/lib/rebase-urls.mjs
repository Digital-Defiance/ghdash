#!/usr/bin/env node
// Templates link to root-absolute paths like href="/posts/x". On a GitHub Pages project site the
// site lives under /<repo>/, so prefix those paths in the built HTML, CSS and XML.
// Usage: BASE_PATH=/repo ghdash-pages finish <distDir>
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = (process.env.BASE_PATH ?? "/").replace(/\/+$/, "");
const dir = process.argv[2];
if (!dir) throw new Error("usage: rebase-urls.mjs <distDir>");

// A root-absolute URL that doesn't already start with the base and isn't protocol-relative.
const prefix = base ? new RegExp(`((?:href|src|action|content|poster)=["'])/(?!/|${base.slice(1)}(?:/|["'?#]))`, "g") : null;
const walk = (d) =>
	readdirSync(d).flatMap((n) => {
		const p = join(d, n);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});

// The CMS renders media as /_emdash/api/media/file/<key>; on this site those are static files under media/.
const mediaUrl = /\/_emdash\/api\/media\/file\//g;

let changed = 0;
for (const f of walk(dir).filter((f) => /\.(html|xml)$/.test(f))) {
	const before = readFileSync(f, "utf8");
	const after = before.replace(mediaUrl, `${base}/media/`).replace(prefix ?? /(?!)/g, `$1${base}/`);
	if (after !== before) {
		writeFileSync(f, after);
		changed++;
	}
}
console.log(`rebased URLs in ${changed} files under ${base}/`);
