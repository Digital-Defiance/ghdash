// Puts the in-browser API (a release asset of Digital-Defiance/ghdash) into public/studio-api/.
// BROWSER_API_DIR=<dir> copies a local build instead (see ghpages-port/browser-api/build.sh).
// A failed download is a warning, not an error: the site still builds, without a working /studio/.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TAG = process.env.BROWSER_API_TAG || "pages-v0.11.0";
const url = process.env.BROWSER_API_URL || `https://github.com/Digital-Defiance/ghdash/releases/download/${TAG}/ghdash-browser-api-${TAG}.tgz`;
const out = "public/studio-api";

rmSync(out, { recursive: true, force: true });
if (process.env.BROWSER_API_DIR) {
	cpSync(process.env.BROWSER_API_DIR, out, { recursive: true });
	console.log(`copied ${process.env.BROWSER_API_DIR} -> ${out}`);
} else {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
		const tgz = join(tmpdir(), "ghdash-browser-api.tgz");
		writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
		mkdirSync(out, { recursive: true });
		execFileSync("tar", ["-xzf", tgz, "-C", out]);
		console.log(`fetched ${url}`);
	} catch (e) {
		console.warn(`WARNING: could not fetch the browser API from ${url} (${e.message}). /studio/ will not work in this build.`);
	}
}
if (!existsSync(join(out, "entry.js"))) console.warn("WARNING: public/studio-api/entry.js is missing");
