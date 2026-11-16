import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { planRedirects, redirectsFile } from "./redirects.mjs";

const RE_1 = /url=\/repo\/posts\/new\//;
const RE_2 = /url=https:\/\/example\.com\/x\?a=1&amp;b=2/;

const row = (o) => ({
	source: "/old",
	destination: "/posts/new/",
	enabled: 1,
	is_pattern: 0,
	...o,
});

test("an internal destination gets the base path and the page lives at the source path", () => {
	const { pages } = planRedirects([row({})], "/repo");
	assert.equal(pages.length, 1);
	assert.equal(pages[0].path, join("/old", "index.html"));
	assert.match(pages[0].html, RE_1);
});

test("external destinations are left alone and disabled, pattern and unsafe rows are skipped", () => {
	const { pages, skipped } = planRedirects(
		[
			row({ destination: "https://example.com/x?a=1&b=2" }),
			row({ source: "/off", enabled: 0 }),
			row({ source: "/p/(.*)", is_pattern: 1 }),
			row({ source: "/../etc" }),
			row({ source: "//evil" }),
		],
		"/repo",
	);
	assert.equal(pages.length, 1);
	assert.match(pages[0].html, RE_2);
	assert.equal(skipped.length, 3);
});

test("the _redirects file sends real redirects with the base path and the row's status", () => {
	const { text, skipped } = redirectsFile(
		[
			row({}),
			row({ source: "/tmp", destination: "https://example.com/x", type: 302 }),
			row({ source: "/p/(.*)", is_pattern: 1 }),
			row({ source: "/off", enabled: 0 }),
			row({ source: "//evil" }),
		],
		"/repo",
	);
	assert.equal(text, "/repo/old /repo/posts/new/ 301\n/repo/tmp https://example.com/x 302\n");
	assert.deepEqual(skipped, ["/p/(.*)", "//evil"]);
});
