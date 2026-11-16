import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchGitLabComments, newIssueUrl } from "./gitlab-comments.mjs";

const API = "https://gitlab.test/api/v4";
const NOTES_PATH = /^\/issues\/(\d+)\/notes$/;
const PREFIX = `/api/v4/projects/${encodeURIComponent("g/site")}`;
const respond = (body, nextPage = "") =>
	new Response(JSON.stringify(body), { headers: { "x-next-page": nextPage } });

function fakeGitLab(issues, notes) {
	const seen = [];
	const fetchImpl = async (url) => {
		const u = new URL(url);
		seen.push(u.pathname + u.search);
		const path = u.pathname.slice(PREFIX.length);
		const page = Number(u.searchParams.get("page"));
		if (path === "/issues")
			return respond(page === 1 ? issues.slice(0, 2) : issues.slice(2), page === 1 ? "2" : "");
		const m = path.match(NOTES_PATH);
		if (m) return respond(notes[m[1]] ?? []);
		return new Response("{}", { status: 404 });
	};
	return { seen, fetchImpl };
}

const note = (id, o = {}) => ({
	id,
	body: `note ${id}`,
	system: false,
	internal: false,
	created_at: "2026-11-16T10:00:00Z",
	author: {
		name: "Ada",
		username: "ada",
		avatar_url: "https://a/x.png",
		web_url: "https://gitlab.test/ada",
	},
	...o,
});

test("comments come from issues titled for each post, without system, internal or confidential ones", async () => {
	const issues = [
		{
			iid: 1,
			title: "Comments: post-a",
			state: "opened",
			web_url: "https://gitlab.test/g/site/-/issues/1",
		},
		{ iid: 2, title: "Bug: Comments: are broken", state: "opened", web_url: "x" },
		{
			iid: 3,
			title: "Comments: post-b",
			state: "closed",
			web_url: "https://gitlab.test/g/site/-/issues/3",
		},
		{ iid: 4, title: "Comments: secret", state: "opened", confidential: true, web_url: "y" },
	];
	const notes = {
		1: [note(10), note(11, { system: true }), note(12, { internal: true })],
		3: [note(30)],
	};
	const f = fakeGitLab(issues, notes);
	const got = await fetchGitLabComments({ apiUrl: API, project: "g/site", fetchImpl: f.fetchImpl });
	assert.deepEqual(
		Object.keys(got).toSorted((a, b) => a.localeCompare(b)),
		["post-a", "post-b"],
	);
	assert.equal(got["post-a"].open, true);
	assert.equal(got["post-b"].open, false);
	assert.deepEqual(
		got["post-a"].comments.map((c) => [c.id, c.body, c.author.username, c.url]),
		[[10, "note 10", "ada", "https://gitlab.test/g/site/-/issues/1#note_10"]],
	);
	assert.ok(!f.seen.some((s) => s.includes("/issues/2/") || s.includes("/issues/4/")));
});

test("a post without an issue links to a filled-in new-issue form", () => {
	const url = new URL(newIssueUrl("https://gitlab.com", "g/site", "01ABC"));
	assert.equal(url.pathname, "/g/site/-/issues/new");
	assert.equal(url.searchParams.get("issue[title]"), "Comments: 01ABC");
});
