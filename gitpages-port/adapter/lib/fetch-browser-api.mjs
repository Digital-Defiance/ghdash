import { execFileSync } from "node:child_process";
// Puts the in-browser API (a release asset of Digital-Defiance/gitdash) into public/studio-api/.
// BROWSER_API_DIR=<dir> copies a local build instead (see gitpages-port/browser-api/build.sh).
// A failed download is a warning, not an error: the site still builds, without a working /studio/.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TAG = process.env.BROWSER_API_TAG || "pages-v0.18.0";
const base = `https://github.com/Digital-Defiance/gitdash/releases/download/${TAG}`;
// Releases up to pages-v0.17.0 name the file ghdash-browser-api-<tag>.tgz.
const urls = process.env.BROWSER_API_URL
	? [process.env.BROWSER_API_URL]
	: [`${base}/gitdash-browser-api-${TAG}.tgz`, `${base}/ghdash-browser-api-${TAG}.tgz`];
const out = "public/studio-api";

rmSync(out, { recursive: true, force: true });
if (process.env.BROWSER_API_DIR) {
	cpSync(process.env.BROWSER_API_DIR, out, { recursive: true });
	console.log(`copied ${process.env.BROWSER_API_DIR} -> ${out}`);
} else {
	let failure = "";
	for (const url of urls) {
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			const tgz = join(tmpdir(), "gitdash-browser-api.tgz");
			writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
			mkdirSync(out, { recursive: true });
			execFileSync("tar", ["-xzf", tgz, "-C", out]);
			console.log(`fetched ${url}`);
			failure = "";
			break;
		} catch (e) {
			failure = `could not fetch the browser API from ${url} (${e.message})`;
		}
	}
	if (failure) console.warn(`WARNING: ${failure}. /studio/ will not work in this build.`);
}
if (!existsSync(join(out, "entry.js")))
	console.warn("WARNING: public/studio-api/entry.js is missing");
