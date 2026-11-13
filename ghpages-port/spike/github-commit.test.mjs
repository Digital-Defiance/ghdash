// In-memory fake of the Git Data API endpoints commitFiles uses, including fast-forward enforcement.
import assert from "node:assert/strict";
import { test } from "node:test";
import { commitFiles } from "./github-commit.mjs";

function fakeGitHub() {
	let n = 0;
	const id = () => `sha${++n}`;
	const objects = new Map();
	const root = id();
	objects.set(root, { files: { "README.md": "hi" } });
	const c0 = id();
	objects.set(c0, { tree: root, parents: [] });
	const state = { head: c0, objects };
	const reply = (status, body) => new Response(JSON.stringify(body), { status });
	state.fetch = async (url, init) => {
		const path = new URL(url).pathname.replace("/repos/o/r/git", "");
		const body = init.body ? JSON.parse(init.body) : null;
		if (init.method === "GET" && path === "/ref/heads/main") return reply(200, { object: { sha: state.head } });
		if (init.method === "GET" && path.startsWith("/commits/")) {
			const c = objects.get(path.split("/")[2]);
			return reply(200, { tree: { sha: c.tree } });
		}
		if (init.method === "POST" && path === "/blobs") {
			const s = id();
			objects.set(s, { blob: body.content });
			return reply(201, { sha: s });
		}
		if (init.method === "POST" && path === "/trees") {
			const files = { ...objects.get(body.base_tree).files };
			for (const e of body.tree) {
				if (e.sha === null) delete files[e.path];
				else files[e.path] = e.content ?? `blob:${e.sha}`;
			}
			const s = id();
			objects.set(s, { files });
			return reply(201, { sha: s });
		}
		if (init.method === "POST" && path === "/commits") {
			const s = id();
			objects.set(s, { tree: body.tree, parents: body.parents });
			return reply(201, { sha: s });
		}
		if (init.method === "PATCH" && path === "/refs/heads/main") {
			if (objects.get(body.sha).parents[0] !== state.head) return reply(422, { message: "Update is not a fast forward" });
			state.head = body.sha;
			return reply(200, { object: { sha: body.sha } });
		}
		return reply(404, { message: `unhandled ${init.method} ${path}` });
	};
	state.files = () => objects.get(objects.get(state.head).tree).files;
	return state;
}

const base = { token: "t", owner: "o", repo: "r", branch: "main" };

test("commits text, binary and deletions atomically", async () => {
	const gh = fakeGitHub();
	const r = await commitFiles({ ...base, fetchImpl: gh.fetch, message: "m",
		files: { "content/a.json": "{}", "media/x.png": new Uint8Array([1, 2, 3]), "README.md": null } });
	assert.equal(r.ok, true);
	assert.deepEqual(Object.keys(gh.files()).sort(), ["content/a.json", "media/x.png"]);
});

test("reports a conflict when the head moved since the admin loaded", async () => {
	const gh = fakeGitHub();
	const loaded = gh.head;
	await commitFiles({ ...base, fetchImpl: gh.fetch, message: "other editor", files: { "b.json": "1" } });
	const r = await commitFiles({ ...base, fetchImpl: gh.fetch, message: "m", expectedHeadSha: loaded, files: { "c.json": "2" } });
	assert.equal(r.conflict, true);
	assert.equal("c.json" in gh.files(), false);
});

test("reports a conflict when another push lands mid-commit", async () => {
	const gh = fakeGitHub();
	const inner = gh.fetch;
	let raced = false;
	gh.fetch = async (url, init) => {
		if (!raced && init.method === "PATCH") {
			raced = true;
			await commitFiles({ ...base, fetchImpl: inner, message: "race", files: { "race.json": "x" } });
		}
		return inner(url, init);
	};
	const r = await commitFiles({ ...base, fetchImpl: gh.fetch, message: "m", files: { "mine.json": "y" } });
	assert.equal(r.conflict, true);
	assert.ok("race.json" in gh.files());
	assert.equal("mine.json" in gh.files(), false);
});
