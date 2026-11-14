import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { planRedirects } from "./redirects.mjs";

const row = (o) => ({ source: "/old", destination: "/posts/new/", enabled: 1, is_pattern: 0, ...o });

test("an internal destination gets the base path and the page lives at the source path", () => {
	const { pages } = planRedirects([row({})], "/repo");
	assert.equal(pages.length, 1);
	assert.equal(pages[0].path, join("/old", "index.html"));
	assert.match(pages[0].html, /url=\/repo\/posts\/new\//);
});

test("external destinations are left alone and disabled, pattern and unsafe rows are skipped", () => {
	const { pages, skipped } = planRedirects(
		[row({ destination: "https://example.com/x?a=1&b=2" }), row({ source: "/off", enabled: 0 }), row({ source: "/p/(.*)", is_pattern: 1 }), row({ source: "/../etc" }), row({ source: "//evil" })],
		"/repo",
	);
	assert.equal(pages.length, 1);
	assert.match(pages[0].html, /url=https:\/\/example\.com\/x\?a=1&amp;b=2/);
	assert.equal(skipped.length, 3);
});
