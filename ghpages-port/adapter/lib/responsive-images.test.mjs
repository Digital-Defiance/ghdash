import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { responsiveImages } from "./responsive-images.mjs";

let sharp;
try { sharp = (await import("sharp")).default; } catch {}

test("wide images get WebP variants and a srcset, small ones and tagged ones are left alone", { skip: !sharp }, async () => {
	const dist = mkdtempSync(join(tmpdir(), "resp-"));
	mkdirSync(join(dist, "media"));
	const img = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } });
	await img(1200, 600).jpeg().toFile(join(dist, "media", "wide.jpg"));
	await img(300, 200).png().toFile(join(dist, "media", "small.png"));
	const html = [
		'<img src="/site/media/wide.jpg" alt="a">',
		'<img src="/site/media/small.png" alt="b" />',
		'<img src="/site/media/wide.jpg" srcset="x 1w" alt="c">',
		'<img src="https://example.com/wide.jpg" alt="d">',
	].join("\n");
	writeFileSync(join(dist, "index.html"), html);
	const done = await responsiveImages(dist, { base: "/site" });
	assert.deepEqual(done, { variants: 2, pages: 1 });
	assert.equal((await sharp(join(dist, "media", "wide-960w.webp")).metadata()).width, 960);
	assert.ok(!existsSync(join(dist, "media", "wide-1600w.webp")));
	const lines = readFileSync(join(dist, "index.html"), "utf8").split("\n");
	assert.equal(
		lines[0],
		'<img src="/site/media/wide.jpg" alt="a" srcset="/site/media/wide-480w.webp 480w, /site/media/wide-960w.webp 960w, /site/media/wide.jpg 1200w" sizes="100vw">',
	);
	assert.equal(lines[1], '<img src="/site/media/small.png" alt="b" />');
	assert.equal(lines[2], '<img src="/site/media/wide.jpg" srcset="x 1w" alt="c">');
	assert.equal(lines[3], '<img src="https://example.com/wide.jpg" alt="d">');
	assert.deepEqual(await responsiveImages(dist, { base: "/site" }), { variants: 0, pages: 0 });
	assert.deepEqual(await responsiveImages(dist, { widths: [] }), { variants: 0, pages: 0 });
});
