// The GitLab save layer against an in-memory stand-in for GitLab's REST API.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	checkAccess,
	commitFiles,
	getHead,
	GitLabError,
	readJsonFiles,
} from "../studio/gitlab-commit.js";
import { createProvider } from "../studio/providers.js";

const API = "https://gitlab.test/api/v4";
const PROJECT = "group/sub/site";
const PID = encodeURIComponent(PROJECT);
const BLOB_RAW = /\/repository\/blobs\/(.+)\/raw$/;
const json = (status, body, headers = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

const FILE_PATH = /\/repository\/files\/(.+)$/;

/** `beforeCommit(state)` runs when a commit arrives, to stand in for someone else pushing first. */
function fakeGitLab({
	files = {},
	canPush = true,
	token = "glpat-ok",
	pageSize = 100,
	beforeCommit,
} = {}) {
	const state = { files: { ...files }, last: {}, head: "c0", n: 0, commits: [], log: [] };
	for (const p of Object.keys(files)) state.last[p] = "c0";
	state.push = (changes) => {
		state.head = `c${++state.n}`;
		for (const [p, c] of Object.entries(changes)) {
			if (c === null) delete state.files[p];
			else state.files[p] = c;
			state.last[p] = state.head;
		}
	};
	const fetchImpl = async (url, init = {}) => {
		const u = new URL(url);
		const method = init.method ?? "GET";
		state.log.push(`${method} ${u.pathname}`);
		if (init.headers?.Authorization !== `Bearer ${token}`)
			return json(401, { message: "401 Unauthorized" });
		const path = u.pathname.slice(new URL(API).pathname.length);
		const proj = `/projects/${PID}`;
		if (path === proj) return json(200, { default_branch: "main", path_with_namespace: PROJECT });
		if (path === `${proj}/repository/branches/main`)
			return json(200, { name: "main", can_push: canPush, commit: { id: state.head } });
		if (path === `${proj}/repository/tree`) {
			const dir = u.searchParams.get("path");
			const recursive = u.searchParams.get("recursive") === "true";
			const all = Object.keys(state.files)
				.filter(
					(p) => p.startsWith(`${dir}/`) && (recursive || !p.slice(dir.length + 1).includes("/")),
				)
				.toSorted((x, y) => x.localeCompare(y))
				.map((p) => ({ type: "blob", path: p, id: `blob:${p}` }));
			if (!all.length) return json(404, { message: "404 Tree Not Found" });
			const page = Number(u.searchParams.get("page"));
			const slice = all.slice((page - 1) * pageSize, page * pageSize);
			return json(200, slice, {
				"x-next-page": page * pageSize < all.length ? String(page + 1) : "",
			});
		}
		const file = path.match(FILE_PATH);
		if (file && method === "HEAD") {
			const p = decodeURIComponent(file[1]);
			if (!(p in state.files)) return new Response(null, { status: 404 });
			return new Response(null, {
				status: 200,
				headers: { "x-gitlab-last-commit-id": state.last[p] },
			});
		}
		const blob = path.match(BLOB_RAW);
		if (blob) return new Response(state.files[decodeURIComponent(blob[1]).slice(5)]);
		if (path === `${proj}/repository/commits` && method === "POST") {
			const body = JSON.parse(init.body);
			if (beforeCommit) {
				beforeCommit(state);
				beforeCommit = undefined;
			}
			for (const a of body.actions) {
				if (a.last_commit_id && a.last_commit_id !== state.last[a.file_path])
					return json(400, {
						message:
							"You are attempting to update a file that has changed since you started editing it.",
					});
				const exists = a.file_path in state.files;
				if (a.action === "create" && exists)
					return json(400, { message: "A file with this name already exists" });
				if ((a.action === "update" || a.action === "delete") && !exists)
					return json(400, { message: "A file with this name doesn't exist" });
			}
			state.push(
				Object.fromEntries(
					body.actions.map((a) => [
						a.file_path,
						a.action === "delete"
							? null
							: a.encoding === "base64"
								? Buffer.from(a.content, "base64")
								: a.content,
					]),
				),
			);
			state.commits.push(body);
			return json(201, { id: state.head });
		}
		return json(404, { message: `no route ${method} ${path}` });
	};
	return { state, fetchImpl };
}

const opts = (f, extra = {}) => ({
	token: "glpat-ok",
	apiUrl: API,
	project: PROJECT,
	branch: "main",
	fetchImpl: f.fetchImpl,
	...extra,
});

test("checkAccess reports whether the token may push to the branch", async () => {
	assert.deepEqual(await checkAccess(opts(fakeGitLab())), { canPush: true, defaultBranch: "main" });
	assert.equal((await checkAccess(opts(fakeGitLab({ canPush: false })))).canPush, false);
	await assert.rejects(
		checkAccess(opts(fakeGitLab(), { token: "bad" })),
		(e) => e instanceof GitLabError && e.status === 401,
	);
});

test("readJsonFiles reads every .json file under the prefix across pages", async () => {
	const files = {
		"content/a.json": '{"a":1}',
		"content/ec_posts/1.json": "{}",
		"content/notes.txt": "x",
		"media/x.png": "p",
	};
	for (let i = 0; i < 5; i++) files[`content/ec_pages/${i}.json`] = `{"i":${i}}`;
	const f = fakeGitLab({ files, pageSize: 2 });
	const got = await readJsonFiles(opts(f, { ref: "c0", prefix: "content/" }));
	assert.deepEqual(
		[...got.keys()].toSorted((x, y) => x.localeCompare(y)),
		[
			"a.json",
			"ec_pages/0.json",
			"ec_pages/1.json",
			"ec_pages/2.json",
			"ec_pages/3.json",
			"ec_pages/4.json",
			"ec_posts/1.json",
		],
	);
	assert.equal(got.get("ec_pages/3.json"), '{"i":3}');
});

test("commitFiles makes one commit that creates, updates and deletes, with binary media", async () => {
	const f = fakeGitLab({
		files: { "content/options.json": "old", "content/ec_posts/gone.json": "x" },
	});
	const png = new Uint8Array([137, 80, 78, 71, 0, 255]);
	const r = await commitFiles(
		opts(f, {
			expectedHeadSha: "c0",
			message: "Edit from the studio",
			files: {
				"content/options.json": "new",
				"content/ec_posts/new.json": "{}",
				"content/ec_posts/gone.json": null,
				"media/2026/11/a.png": png,
			},
		}),
	);
	assert.deepEqual(r, { ok: true, commitSha: "c1" });
	assert.equal(f.state.commits.length, 1);
	assert.deepEqual(
		f.state.commits[0].actions.map((a) => [a.action, a.file_path]),
		[
			["update", "content/options.json"],
			["create", "content/ec_posts/new.json"],
			["delete", "content/ec_posts/gone.json"],
			["create", "media/2026/11/a.png"],
		],
	);
	assert.equal(f.state.files["content/options.json"], "new");
	assert.deepEqual([...f.state.files["media/2026/11/a.png"]], [...png]);
	assert.ok(!("content/ec_posts/gone.json" in f.state.files));
});

test("commitFiles reports a conflict when the branch moved since the studio loaded", async () => {
	const f = fakeGitLab({ files: { "content/a.json": "1" } });
	f.state.head = "someone-else";
	const r = await commitFiles(
		opts(f, { expectedHeadSha: "c0", message: "m", files: { "content/a.json": "2" } }),
	);
	assert.deepEqual(r, { ok: false, conflict: true, headSha: "someone-else" });
	assert.equal(f.state.commits.length, 0);
	assert.equal(f.state.files["content/a.json"], "1");
});

test("the provider gives the tray GitLab's links and keeps GitHub as the default", async () => {
	const f = fakeGitLab();
	const p = createProvider(
		{
			provider: "gitlab",
			repo: PROJECT,
			branch: "main",
			apiUrl: API,
			webUrl: "https://gitlab.test",
		},
		f.fetchImpl,
	);
	assert.equal(p.label, "GitLab");
	assert.equal(p.owner, "group/sub");
	assert.equal(p.repo, "site");
	assert.equal(p.commitUrl("c1"), "https://gitlab.test/group/sub/site/-/commit/c1");
	assert.equal(p.buildsUrl, "https://gitlab.test/group/sub/site/-/pipelines");
	assert.equal(await p.getHead("glpat-ok"), "c0");
	assert.deepEqual(p.describeError(new GitLabError(401, {})), { status: 401, auth: true });
	const g = createProvider({ repo: "o/r", branch: "main" }, f.fetchImpl);
	assert.equal(g.name, "github");
	assert.equal(g.commitUrl("s"), "https://github.com/o/r/commit/s");
	assert.equal(g.describeError(new GitLabError(401, {})), null);
	assert.equal(await getHead(opts(f)), "c0");
});

test("a push that lands between the head check and the commit doesn't overwrite the other edit", async () => {
	const f = fakeGitLab({
		files: { "content/a.json": "1", "content/b.json": "1" },
		beforeCommit: (state) => state.push({ "content/a.json": "theirs" }),
	});
	const r = await commitFiles(
		opts(f, { expectedHeadSha: "c0", message: "m", files: { "content/a.json": "mine" } }),
	);
	assert.deepEqual(r, { ok: false, conflict: true, headSha: "c1" });
	assert.equal(f.state.files["content/a.json"], "theirs");
	assert.equal(f.state.commits.length, 0);
});

test("updates and deletes carry each file's last commit; new files don't", async () => {
	const f = fakeGitLab({ files: { "content/a.json": "1", "content/gone.json": "x" } });
	f.state.push({ "content/a.json": "2" });
	const r = await commitFiles(
		opts(f, {
			expectedHeadSha: "c1",
			message: "m",
			files: { "content/a.json": "3", "content/gone.json": null, "content/new.json": "{}" },
		}),
	);
	assert.equal(r.ok, true);
	assert.deepEqual(
		f.state.commits[0].actions.map((a) => [a.action, a.file_path, a.last_commit_id]),
		[
			["update", "content/a.json", "c1"],
			["delete", "content/gone.json", "c0"],
			["create", "content/new.json", undefined],
		],
	);
});
