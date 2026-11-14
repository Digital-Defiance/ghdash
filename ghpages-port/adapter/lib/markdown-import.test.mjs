import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cleanLiquid, parseFrontMatter, planEntries } from "./markdown-import.mjs";

test("front matter handles quotes, inline and block lists, booleans", () => {
	const { data, body } = parseFrontMatter(
		'---\ntitle: "Hello: world"\ntags: [a, "b c"]\ncategories:\n  - news\n  - dev\npublished: false\ndate: 2024-03-05 10:00:00 +0100\n---\nBody here\n',
	);
	assert.deepEqual(data, {
		title: "Hello: world",
		tags: ["a", "b c"],
		categories: ["news", "dev"],
		published: false,
		date: "2024-03-05 10:00:00 +0100",
	});
	assert.equal(body, "Body here\n");
	assert.deepEqual(parseFrontMatter("no front matter"), { data: {}, body: "no front matter" });
});

test("simple Liquid becomes Markdown and the rest is counted", () => {
	const r = cleanLiquid(
		'{{ site.baseurl }}/a {{ "/b" | relative_url }} {% raw %}x{% endraw %} {% include foo.html %} {{ page.title }}',
	);
	assert.equal(r.text, "/a /b x  ");
	assert.equal(r.unsupported, 2);
});

test("a Jekyll site becomes posts, drafts and pages with images and tags", () => {
	const root = mkdtempSync(join(tmpdir(), "jekyll-"));
	for (const d of ["_posts", "_drafts", "assets/img", "docs"])
		mkdirSync(join(root, d), { recursive: true });
	writeFileSync(join(root, "assets/img/pic.png"), "png");
	writeFileSync(
		join(root, "_posts/2024-03-05-first-post.md"),
		"---\ntitle: First\ntags: alpha beta\ncategories: [news]\n---\nHi ![a](/assets/img/pic.png) ![b](/assets/img/missing.png) ![c](https://x.test/y.png)\n",
	);
	writeFileSync(join(root, "_posts/2024-04-01-no-title.markdown"), "# From heading\n\ntext\n");
	writeFileSync(join(root, "_drafts/wip.md"), "---\ntitle: WIP\n---\nlater\n");
	writeFileSync(join(root, "_posts/2024-05-01-hidden.md"), "---\npublished: false\n---\nx\n");
	writeFileSync(join(root, "about.md"), "---\ntitle: About\n---\nme\n");
	writeFileSync(join(root, "docs/index.md"), "# Docs\n");
	writeFileSync(join(root, "README.md"), "skip me");
	const { entries, warnings } = planEntries(root);
	const by = Object.fromEntries(entries.map((e) => [`${e.collection}/${e.slug}`, e]));
	assert.deepEqual(Object.keys(by).sort(), [
		"pages/about",
		"pages/docs",
		"posts/first-post",
		"posts/hidden",
		"posts/no-title",
		"posts/wip",
	]);
	assert.equal(by["posts/first-post"].publishedAt, "2024-03-05T00:00:00.000Z");
	assert.deepEqual(by["posts/first-post"].tags, ["alpha", "beta"]);
	assert.deepEqual(by["posts/first-post"].categories, ["news"]);
	assert.equal(by["posts/first-post"].images.length, 1);
	assert.match(by["posts/first-post"].body, /!\[a\]\(\u0000IMG0\u0000\)/);
	assert.match(by["posts/first-post"].body, /missing\.png/);
	assert.deepEqual(warnings.filter((w) => w.includes("missing")).length, 1);
	assert.equal(by["posts/no-title"].title, "From heading");
	assert.equal(by["posts/no-title"].body.trim(), "text");
	assert.equal(by["posts/wip"].status, "draft");
	assert.equal(by["posts/hidden"].status, "draft");
	assert.equal(by["pages/docs"].title, "Docs");
	assert.equal(by["pages/about"].status, "published");
});
