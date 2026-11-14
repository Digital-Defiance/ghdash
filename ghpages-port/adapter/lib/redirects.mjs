#!/usr/bin/env node
// GitHub Pages can't send 301s, so each enabled redirect from content/_emdash_redirects.json becomes a small
// HTML page at its source path that forwards the browser (meta refresh) and names the target as canonical.
// Pattern redirects can't be pre-rendered and are skipped. Usage: BASE_PATH=/repo ghdash-pages finish <distDir>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function redirectPage(destination) {
	const to = escapeHtml(destination);
	return `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting…</title><meta name="robots" content="noindex"><link rel="canonical" href="${to}"><meta http-equiv="refresh" content="0; url=${to}"></head><body><p>Redirecting to <a href="${to}">${to}</a>.</p></body></html>\n`;
}

/** Returns { pages: [{ path, html }], skipped: [source] } for the given redirect rows. */
export function planRedirects(rows, base = "") {
	const pages = [];
	const skipped = [];
	for (const r of rows) {
		if (!r.enabled) continue;
		const source = String(r.source);
		const safeSource = source.startsWith("/") && !source.startsWith("//") && !source.split("/").includes("..");
		if (r.is_pattern || !safeSource) { skipped.push(source); continue; }
		const external = /^[a-z][a-z0-9+.-]*:/i.test(r.destination);
		const destination = external || !String(r.destination).startsWith("/") ? r.destination : base + r.destination;
		pages.push({ path: join(source.replace(/\/+$/, ""), "index.html"), html: redirectPage(destination) });
	}
	return { pages, skipped };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dist = process.argv[2];
	if (!dist) throw new Error("usage: redirects.mjs <distDir>");
	const file = join("content", "_emdash_redirects.json");
	const rows = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
	const { pages, skipped } = planRedirects(rows, (process.env.BASE_PATH ?? "").replace(/\/+$/, ""));
	let written = 0;
	for (const p of pages) {
		const out = join(dist, p.path);
		if (existsSync(out)) { console.warn(`redirect source ${p.path} is a real page, skipped`); continue; }
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, p.html);
		written++;
	}
	for (const s of skipped) console.warn(`redirect ${s} skipped (pattern or unsafe path)`);
	console.log(`wrote ${written} redirect pages`);
}
