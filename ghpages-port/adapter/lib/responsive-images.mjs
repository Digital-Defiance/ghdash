#!/usr/bin/env node
// Adds WebP variants of media under <distDir>/media and a srcset to built <img> tags that point at them.
// Needs `sharp` (Astro installs it); does nothing without it.
// Usage: BASE_PATH=/repo gitdash-pages finish <distDir>   (set RESPONSIVE_WIDTHS="" to turn it off)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { basePrefix } from "./host.mjs";

const RE_1 = /\ssrcset=/;
const RE_2 = /\ssrc=["']([^"']+)["']/;
const RE_3 = /\ssizes=/;
const RE_4 = /\/?>$/;

const SOURCE = new Set([".jpg", ".jpeg", ".png"]);
const walk = (d) =>
	readdirSync(d).flatMap((n) => {
		const p = join(d, n);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});

export async function responsiveImages(
	dist,
	{ base = "", widths = [480, 960, 1600], sizes = "100vw" } = {},
) {
	if (!widths.length || !existsSync(join(dist, "media"))) return { variants: 0, pages: 0 };
	let sharp;
	try {
		sharp = (await import("sharp")).default;
	} catch {
		return { variants: 0, pages: 0 };
	}
	const known = new Map();
	let variants = 0;
	for (const file of walk(join(dist, "media")).filter((f) =>
		SOURCE.has(extname(f).toLowerCase()),
	)) {
		const width = (await sharp(file).metadata()).width;
		if (!width) continue;
		const stem = file.slice(0, -extname(file).length);
		const candidates = [];
		for (const w of widths.filter((n) => n < width)) {
			const out = `${stem}-${w}w.webp`;
			if (!existsSync(out)) {
				await sharp(file).rotate().resize({ width: w }).webp({ quality: 78 }).toFile(out);
				variants++;
			}
			candidates.push(
				`${base}/media/${relative(join(dist, "media"), out).split("\\").join("/")} ${w}w`,
			);
		}
		if (!candidates.length) continue;
		const url = `${base}/media/${relative(join(dist, "media"), file).split("\\").join("/")}`;
		known.set(url, [...candidates, `${url} ${width}w`].join(", "));
	}
	let pages = 0;
	for (const f of walk(dist).filter((p) => p.endsWith(".html"))) {
		const before = readFileSync(f, "utf8");
		const after = before.replace(/<img\b[^>]*>/g, (tag) => {
			if (RE_1.test(tag)) return tag;
			const src = RE_2.exec(tag)?.[1];
			const set = src && known.get(src);
			if (!set) return tag;
			const hasSizes = RE_3.test(tag);
			return tag.replace(
				RE_4,
				(end) => ` srcset="${set}"${hasSizes ? "" : ` sizes="${sizes}"`}${end}`,
			);
		});
		if (after !== before) {
			writeFileSync(f, after);
			pages++;
		}
	}
	return { variants, pages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const dist = process.argv[2];
	if (!dist) throw new Error("usage: responsive-images.mjs <distDir>");
	const base = basePrefix();
	const env = process.env.RESPONSIVE_WIDTHS;
	const widths = env === undefined ? undefined : env.split(",").map(Number).filter(Boolean);
	const { variants, pages } = await responsiveImages(dist, {
		base,
		widths,
		sizes: process.env.RESPONSIVE_SIZES || undefined,
	});
	console.log(`responsive images: ${variants} WebP variants, srcset added in ${pages} pages`);
}
