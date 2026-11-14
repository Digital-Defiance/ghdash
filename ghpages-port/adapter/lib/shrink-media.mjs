// Downscales large raster images in place. Needs `sharp` (Astro installs it); does nothing without it.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const RASTER = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export async function shrinkMedia(dir, maxWidth) {
	if (!maxWidth) return [];
	let sharp;
	try {
		sharp = (await import("sharp")).default;
	} catch {
		return [];
	}
	const shrunk = [];
	const walk = async (d) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) { await walk(p); continue; }
			if (!RASTER.has(extname(name).toLowerCase())) continue;
			const meta = await sharp(p).metadata();
			if (!meta.width || meta.width <= maxWidth) continue;
			const out = await sharp(p).rotate().resize({ width: maxWidth, withoutEnlargement: true }).toBuffer();
			if (out.length >= statSync(p).size) continue;
			writeFileSync(p, out);
			shrunk.push(p);
		}
	};
	await walk(dir);
	return shrunk;
}
