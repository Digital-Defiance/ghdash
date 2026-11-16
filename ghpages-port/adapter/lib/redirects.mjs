#!/usr/bin/env node
// GitHub Pages can't send 301s, so each enabled redirect from content/_emdash_redirects.json becomes a small
// HTML page at its source path that forwards the browser (meta refresh) and names the target as canonical.
// Netlify, Cloudflare Pages and GitLab Pages read a _redirects file and send real redirects, so on those hosts that file is written instead.
// Pattern redirects can't be pre-rendered and are skipped. Usage: ghdash-pages finish <distDir>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { basePrefix, hostName } from "./host.mjs";

const RE_1 = /^[a-z][a-z0-9+.-]*:/i;
const RE_2 = /\/+$/;

const escapeHtml = (s) =>
	s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
		const safeSource =
			source.startsWith("/") && !source.startsWith("//") && !source.split("/").includes("..");
		if (r.is_pattern || !safeSource) {
			skipped.push(source);
			continue;
		}
		const external = RE_1.test(r.destination);
		const destination =
			external || !String(r.destination).startsWith("/") ? r.destination : base + r.destination;
		pages.push({
			path: join(source.replace(RE_2, ""), "index.html"),
			html: redirectPage(destination),
		});
	}
	return { pages, skipped };
}

const STATUS = { 301: 301, 302: 302, 307: 302, 308: 301 };

/** The body of a Netlify / Cloudflare Pages / GitLab Pages `_redirects` file for the given rows, and the sources it skipped. */
export function redirectsFile(rows, base = "") {
	const lines = [];
	const skipped = [];
	for (const r of rows) {
		if (!r.enabled) continue;
		const source = String(r.source);
		const destination = String(r.destination);
		if (
			r.is_pattern ||
			!source.startsWith("/") ||
			source.startsWith("//") ||
			/\s/.test(source + destination)
		) {
			skipped.push(source);
			continue;
		}
		const to =
			RE_1.test(destination) || !destination.startsWith("/") ? destination : base + destination;
		lines.push(`${base}${source} ${to} ${STATUS[r.type] ?? 301}`);
	}
	return { text: lines.length ? `${lines.join("\n")}\n` : "", skipped };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dist = process.argv[2];
	if (!dist) throw new Error("usage: redirects.mjs <distDir>");
	const file = join("content", "_emdash_redirects.json");
	const rows = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
	const base = basePrefix();
	if (["netlify", "cloudflare-pages", "gitlab-pages"].includes(hostName())) {
		const { text, skipped } = redirectsFile(rows, base);
		const out = join(dist, "_redirects");
		const before = existsSync(out) ? readFileSync(out, "utf8") : "";
		if (text) writeFileSync(out, before + (before && !before.endsWith("\n") ? "\n" : "") + text);
		for (const s of skipped) console.warn(`redirect ${s} skipped (pattern or unsafe path)`);
		console.log(`wrote ${text.split("\n").filter(Boolean).length} rules to _redirects`);
		process.exit(0);
	}
	const { pages, skipped } = planRedirects(rows, base);
	let written = 0;
	for (const p of pages) {
		const out = join(dist, p.path);
		if (existsSync(out)) {
			console.warn(`redirect source ${p.path} is a real page, skipped`);
			continue;
		}
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, p.html);
		written++;
	}
	for (const s of skipped) console.warn(`redirect ${s} skipped (pattern or unsafe path)`);
	console.log(`wrote ${written} redirect pages`);
}
