#!/usr/bin/env node
// Files uploaded in the studio are committed under media/. Serve them from <site>/media/.
// Large photos are downscaled in the copy (the originals in media/ are untouched).
// MEDIA_MAX_WIDTH sets the limit in pixels (default 2000, 0 turns it off).
import { cpSync, existsSync, rmSync } from "node:fs";

import { shrinkMedia } from "./shrink-media.mjs";

rmSync("public/media", { recursive: true, force: true });
if (existsSync("media")) {
	cpSync("media", "public/media", { recursive: true });
	console.log("copied media/ to public/media/");
	const max = process.env.MEDIA_MAX_WIDTH === undefined ? 2000 : Number(process.env.MEDIA_MAX_WIDTH);
	const shrunk = await shrinkMedia("public/media", max);
	if (shrunk.length) console.log(`downscaled ${shrunk.length} image(s) to at most ${max}px wide`);
}
