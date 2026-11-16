import assert from "node:assert/strict";
import { test } from "node:test";

import {
	basePath,
	basePrefix,
	hostName,
	parseRemote,
	repoMeta,
	siteUrl,
	studioApiOrigin,
} from "./host.mjs";

const noGit = () => "";
const localGit = (cmd, args) =>
	args[0] === "remote" ? "git@github.com:me/site.git" : args[0] === "branch" ? "work" : "sha1";

test("GitHub Actions: the workflow's BASE_PATH and SITE_URL are used as given", () => {
	const env = {
		GITHUB_ACTIONS: "true",
		BASE_PATH: "/GitDash-example",
		SITE_URL: "https://o.github.io",
	};
	assert.equal(hostName(env), "github-pages");
	assert.equal(basePath(env), "/GitDash-example");
	assert.equal(basePrefix(env), "/GitDash-example");
	assert.equal(siteUrl(env), "https://o.github.io");
});

test("GitHub Pages with a custom domain passes an empty BASE_PATH and is served from the root", () => {
	const env = { GITHUB_ACTIONS: "true", BASE_PATH: "" };
	assert.equal(basePath(env), "/");
	assert.equal(basePrefix(env), "");
});

test("Netlify is served from the root, at the production address or the deploy's own", () => {
	const prod = {
		NETLIFY: "true",
		CONTEXT: "production",
		URL: "https://site.netlify.app",
		DEPLOY_PRIME_URL: "https://main--site.netlify.app",
	};
	assert.equal(hostName(prod), "netlify");
	assert.equal(basePath(prod), "/");
	assert.equal(siteUrl(prod), "https://site.netlify.app");
	assert.equal(siteUrl({ ...prod, CONTEXT: "deploy-preview" }), "https://main--site.netlify.app");
});

test("GitLab Pages: a project site lives under its path, a unique-domain site at the root", () => {
	const project = { GITLAB_CI: "true", CI_PAGES_URL: "https://group.gitlab.io/my-site" };
	assert.equal(hostName(project), "gitlab-pages");
	assert.equal(basePath(project), "/my-site");
	assert.equal(siteUrl(project), "https://group.gitlab.io");
	const unique = { GITLAB_CI: "true", CI_PAGES_URL: "https://my-site-abc123.gitlab.io" };
	assert.equal(basePath(unique), "/");
	assert.equal(basePath({ ...project, BASE_PATH: "/other/" }), "/other");
});

test("remotes: GitHub and GitLab over https and ssh, credentials dropped, others unknown", () => {
	assert.deepEqual(parseRemote("git@github.com:Digital-Defiance/GitDash-example.git"), {
		provider: "github",
		webUrl: "https://github.com",
		apiUrl: "https://api.github.com",
		path: "Digital-Defiance/GitDash-example",
	});
	assert.deepEqual(parseRemote("https://oauth2:secret@gitlab.com/group/sub/site.git"), {
		provider: "gitlab",
		webUrl: "https://gitlab.com",
		apiUrl: "https://gitlab.com/api/v4",
		path: "group/sub/site",
	});
	assert.equal(
		parseRemote("git@gitlab.example.org:team/site.git").apiUrl,
		"https://gitlab.example.org/api/v4",
	);
	assert.equal(parseRemote("https://bitbucket.org/a/b"), null);
	assert.equal(parseRemote(""), null);
});

test("GitLab CI: the studio commits to this project through this instance's API", () => {
	const env = {
		GITLAB_CI: "true",
		CI_PROJECT_PATH: "group/sub/site",
		CI_SERVER_URL: "https://gitlab.example.org",
		CI_API_V4_URL: "https://gitlab.example.org/api/v4",
		CI_COMMIT_REF_NAME: "main",
		CI_COMMIT_SHA: "abc",
	};
	assert.deepEqual(repoMeta(env, noGit), {
		provider: "gitlab",
		repo: "group/sub/site",
		branch: "main",
		head: "abc",
		apiUrl: "https://gitlab.example.org/api/v4",
		webUrl: "https://gitlab.example.org",
	});
	assert.equal(studioApiOrigin(env, noGit), "https://gitlab.example.org");
});

test("Netlify: the repository comes from REPOSITORY_URL, whichever host it is on", () => {
	const env = {
		NETLIFY: "true",
		REPOSITORY_URL: "https://gitlab.com/me/site",
		BRANCH: "drafts",
		COMMIT_REF: "def",
	};
	const m = repoMeta(env, noGit);
	assert.equal(m.provider, "gitlab");
	assert.equal(m.repo, "me/site");
	assert.equal(m.branch, "drafts");
	assert.equal(m.head, "def");
	const gh = repoMeta({ ...env, REPOSITORY_URL: "https://github.com/me/site" }, noGit);
	assert.equal(gh.provider, "github");
	assert.equal(gh.apiUrl, "https://api.github.com");
});

test("local builds read the origin remote, and STUDIO_* settings override everything", () => {
	assert.deepEqual(repoMeta({}, localGit), {
		provider: "github",
		repo: "me/site",
		branch: "work",
		head: "sha1",
		apiUrl: "https://api.github.com",
		webUrl: "https://github.com",
	});
	const m = repoMeta(
		{ STUDIO_PROVIDER: "gitlab", STUDIO_REPO: "g/p", STUDIO_WEB_URL: "https://git.example.net" },
		localGit,
	);
	assert.equal(m.provider, "gitlab");
	assert.equal(m.repo, "g/p");
	assert.equal(m.apiUrl, "https://git.example.net/api/v4");
});

test("Cloudflare Pages is served from the root; the branch and commit come from CF_PAGES_*", () => {
	const env = {
		CF_PAGES: "1",
		CF_PAGES_URL: "https://1a2b3c.my-site.pages.dev",
		CF_PAGES_BRANCH: "main",
		CF_PAGES_COMMIT_SHA: "cf1",
	};
	assert.equal(hostName(env), "cloudflare-pages");
	assert.equal(basePath(env), "/");
	assert.equal(siteUrl(env), "https://1a2b3c.my-site.pages.dev");
	assert.equal(siteUrl({ ...env, SITE_URL: "https://example.org" }), "https://example.org");
	const m = repoMeta(env, (cmd, args) =>
		args[0] === "remote" ? "https://github.com/me/site" : "",
	);
	assert.deepEqual([m.provider, m.repo, m.branch, m.head], ["github", "me/site", "main", "cf1"]);
	assert.equal(
		repoMeta({ ...env, STUDIO_PROVIDER: "gitlab", STUDIO_REPO: "g/site" }, noGit).apiUrl,
		"https://gitlab.com/api/v4",
	);
});

test("Cloudflare Workers Builds is treated like Cloudflare Pages; branch and commit come from WORKERS_CI_*", () => {
	const env = { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main", WORKERS_CI_COMMIT_SHA: "wk1" };
	assert.equal(hostName(env), "cloudflare-pages");
	assert.equal(basePath(env), "/");
	assert.equal(siteUrl(env), undefined);
	assert.equal(siteUrl({ ...env, SITE_URL: "https://x.workers.dev" }), "https://x.workers.dev");
	const m = repoMeta(env, (cmd, args) =>
		args[0] === "remote" ? "https://github.com/me/site" : "",
	);
	assert.deepEqual([m.provider, m.repo, m.branch, m.head], ["github", "me/site", "main", "wk1"]);
});
