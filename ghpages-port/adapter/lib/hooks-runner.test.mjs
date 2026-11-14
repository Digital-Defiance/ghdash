import assert from "node:assert/strict";
import { test } from "node:test";

import { eventsFromDiff, resolveSettings, runHooks, toContentItem } from "./hooks-runner.mjs";

const row = { id: "01A", slug: "hello", status: "published", title: "Hello", excerpt: "x", created_at: "t1", updated_at: "t2", published_at: "t3", draft_revision_id: "r1", deleted_at: null };
const files = { "content/ec_posts/01A.json": JSON.stringify(row), "content/ec_posts/01B.json": JSON.stringify({ ...row, id: "01B", deleted_at: "t9" }) };
const read = (path) => files[path];

test("added and modified content files become afterSave events, deletions afterDelete", () => {
	const diff = ["A\tcontent/ec_posts/01A.json", "M\tcontent/ec_posts/01C.json", "D\tcontent/ec_pages/01D.json", "M\tcontent/options.json", "M\tmedia/a.png"].join("\n");
	const events = eventsFromDiff(diff, "HEAD", (p) => (p.endsWith("01C.json") ? JSON.stringify({ ...row, id: "01C" }) : read(p)));
	assert.deepEqual(events.map((e) => [e.hook, e.event.collection, e.event.content?.id ?? e.event.id, e.event.isNew]), [
		["content:afterSave", "posts", "01A", true],
		["content:afterSave", "posts", "01C", false],
		["content:afterDelete", "pages", "01D", undefined],
	]);
});

test("a soft-deleted row is reported as a deletion", () => {
	const events = eventsFromDiff("M\tcontent/ec_posts/01B.json", "HEAD", read);
	assert.deepEqual(events.map((e) => [e.hook, e.event.id]), [["content:afterDelete", "01B"]]);
});

test("the content item separates standard columns from field data", () => {
	const item = toContentItem("posts", row);
	assert.deepEqual(item.data, { title: "Hello", excerpt: "x" });
	assert.equal(item.draftRevisionId, "r1");
	assert.equal(item.type, "posts");
});

test("env settings are resolved and a missing variable leaves the setting unset", () => {
	assert.deepEqual(resolveSettings({ a: 1, url: { env: "U" }, token: { env: "T" } }, { U: "https://x.test" }), { a: 1, url: "https://x.test" });
});

test("hooks get the settings, a failing hook is reported and does not stop the rest", async () => {
	const seen = [];
	const good = { hooks: { "content:afterSave": { handler: async (e, ctx) => { seen.push([e.content.id, await ctx.kv.get("settings:url")]); } } } };
	const bad = { hooks: { "content:afterSave": async () => { throw new Error("boom"); } } };
	const events = eventsFromDiff("A\tcontent/ec_posts/01A.json", "HEAD", read);
	const results = await runHooks({
		plugins: [
			{ plugin: { id: "bad" }, definition: bad, settings: {} },
			{ plugin: { id: "good" }, definition: good, settings: { url: { env: "U" } } },
		],
		events,
		env: { U: "https://x.test" },
	});
	assert.deepEqual(seen, [["01A", "https://x.test"]]);
	assert.deepEqual(results.map((r) => [r.plugin, r.ok]), [["bad", false], ["good", true]]);
});
