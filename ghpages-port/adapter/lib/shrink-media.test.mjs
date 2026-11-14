import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { shrinkMedia } from "./shrink-media.mjs";

let sharp;
try { sharp = (await import("sharp")).default; } catch {}

test("a wide image is downscaled and a small one is left alone", { skip: !sharp }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "media-"));
	const noise = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } });
	await noise(3000, 1000).jpeg().toFile(join(dir, "wide.jpg"));
	await noise(800, 400).png().toFile(join(dir, "small.png"));
	const before = statSync(join(dir, "small.png")).size;
	const done = await shrinkMedia(dir, 2000);
	assert.deepEqual(done.map((p) => p.split("/").pop()), ["wide.jpg"]);
	assert.equal((await sharp(join(dir, "wide.jpg")).metadata()).width, 2000);
	assert.equal(statSync(join(dir, "small.png")).size, before);
	assert.deepEqual(await shrinkMedia(dir, 0), []);
});
