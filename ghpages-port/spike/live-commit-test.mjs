#!/usr/bin/env node
// Live check of github-commit.mjs against a real repo. Run on your own machine; the token stays local.
//
//   GH_TOKEN=github_pat_... node ghpages-port/spike/live-commit-test.mjs Digital-Defiance/GHDash-example
//
// The token needs Contents: read and write on that one repo. It writes to a throwaway branch
// (spike/live-commit-test), never the default branch.
import { checkAccess, commitFiles, getHead } from "./github-commit.mjs";

const [owner, repo] = (process.argv[2] ?? "").split("/");
const token = process.env.GH_TOKEN;
if (!owner || !repo || !token) {
	console.error("usage: GH_TOKEN=... node live-commit-test.mjs <owner>/<repo>");
	process.exit(1);
}
const branch = "spike/live-commit-test";
const api = (method, path, body) =>
	fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
		body: body && JSON.stringify(body),
	});
const check = (label, ok, extra = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
	if (!ok) process.exitCode = 1;
};

const access = await checkAccess({ token, owner, repo });
check("token can push", access.canPush, `default branch ${access.defaultBranch}`);

// An empty repo has no commits, so seed the default branch through the Contents API first.
let base = await api("GET", `/git/ref/heads/${access.defaultBranch}`);
if (base.status === 404 || base.status === 409) {
	const r = await api("PUT", "/contents/README.md", { message: "Initial commit", content: btoa("# GHDash example\n") });
	check("seed empty repo", r.ok, String(r.status));
	base = await api("GET", `/git/ref/heads/${access.defaultBranch}`);
}
const baseSha = (await base.json()).object.sha;
await api("DELETE", `/git/refs/heads/${branch}`);
const created = await api("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: baseSha });
check("create test branch", created.ok, branch);

const loaded = await getHead({ token, owner, repo, branch });
const stamp = new Date().toISOString();
const r1 = await commitFiles({
	token, owner, repo, branch, expectedHeadSha: loaded, message: `spike: multi-file commit ${stamp}`,
	files: {
		"content/ec_posts/01SPIKE.json": JSON.stringify({ id: "01SPIKE", slug: "hello", title: "Hello", updated_at: stamp }, null, "\t") + "\n",
		"content/options.json": JSON.stringify([{ name: "site:title", value: '"Spike"' }], null, "\t") + "\n",
		"media/2026/11/pixel.png": Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)),
	},
});
check("atomic commit of 2 JSON files + 1 binary", r1.ok, r1.commitSha);

const r2 = await commitFiles({ token, owner, repo, branch, expectedHeadSha: loaded, message: "spike: stale write", files: { "x.json": "{}" } });
check("stale head is reported as a conflict", r2.conflict === true);

const r3 = await commitFiles({ token, owner, repo, branch, message: "spike: delete a file", files: { "content/options.json": null } });
check("deletion commit", r3.ok, r3.commitSha);

console.log(`\nInspect: https://github.com/${owner}/${repo}/commits/${branch}`);
