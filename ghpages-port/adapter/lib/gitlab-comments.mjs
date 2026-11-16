#!/usr/bin/env node
// Comments for a site whose repository is on GitLab: each post's comments are the notes on a GitLab issue titled
// "Comments: <term>" (the term is the post's id). The build reads them and the page shows them; visitors comment on GitLab.
// A post with no issue yet links to GitLab's new-issue form with that title filled in, so nobody has to create issues by hand.
//
// Usage: gitdash-pages gitlab-comments [outFile]   (default .gitdash/gitlab-comments.json)
// Reads public projects without a token; set GITLAB_TOKEN (scope read_api) for a private project or a higher rate limit.
// Never fails the build: if GitLab can't be reached the file is written empty and a warning is printed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { repoMeta } from "./host.mjs";

export const TITLE_PREFIX = "Comments: ";

/** The address of GitLab's new-issue form for a post that has no comment issue yet. */
export function newIssueUrl(webUrl, project, term) {
	const q = new URLSearchParams({
		"issue[title]": `${TITLE_PREFIX}${term}`,
		"issue[description]":
			"Comments on this post. Reply below; comments show on the site after its next build.",
	});
	return `${webUrl}/${project}/-/issues/new?${q}`;
}

async function getAll(call, path) {
	const out = [];
	for (let page = 1; page;) {
		const sep = path.includes("?") ? "&" : "?";
		// oxlint-disable-next-line no-await-in-loop -- pages are fetched in order
		const res = await call(`${path}${sep}per_page=100&page=${page}`);
		// oxlint-disable-next-line no-await-in-loop -- pages are fetched in order
		out.push(...(await res.json()));
		page = Number(res.headers.get("x-next-page")) || 0;
	}
	return out;
}

/**
 * Returns { [term]: { issueUrl, open, comments: [{ id, url, author: { name, username, avatarUrl, url }, body, createdAt }] } }.
 * Confidential issues, internal notes and system notes ("changed the title", ...) are left out.
 */
export async function fetchGitLabComments({
	apiUrl,
	project,
	token,
	fetchImpl = globalThis.fetch,
}) {
	const call = async (path) => {
		const res = await fetchImpl(`${apiUrl}/projects/${encodeURIComponent(project)}${path}`, {
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		});
		if (!res.ok) throw new Error(`GitLab API ${res.status} for ${path}`);
		return res;
	};
	const issues = (
		await getAll(
			call,
			`/issues?state=all&in=title&search=${encodeURIComponent(TITLE_PREFIX.trim())}`,
		)
	).filter((i) => i.title.startsWith(TITLE_PREFIX) && !i.confidential);
	const out = {};
	for (const issue of issues.toSorted((a, b) => a.iid - b.iid)) {
		const term = issue.title.slice(TITLE_PREFIX.length).trim();
		if (!term || out[term]) continue;
		// oxlint-disable-next-line no-await-in-loop -- one issue at a time keeps within rate limits
		const notes = await getAll(call, `/issues/${issue.iid}/notes?sort=asc&order_by=created_at`);
		out[term] = {
			issueUrl: issue.web_url,
			open: issue.state === "opened" && !issue.discussion_locked,
			comments: notes
				.filter((n) => !n.system && !n.internal && !n.confidential)
				.map((n) => ({
					id: n.id,
					url: `${issue.web_url}#note_${n.id}`,
					author: {
						name: n.author?.name ?? "",
						username: n.author?.username ?? "",
						avatarUrl: n.author?.avatar_url ?? "",
						url: n.author?.web_url ?? "",
					},
					body: n.body ?? "",
					createdAt: n.created_at,
				})),
		};
	}
	return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const outFile = process.argv[2] ?? ".gitdash/gitlab-comments.json";
	const meta = repoMeta();
	let data = {};
	if (meta.provider !== "gitlab" || !meta.repo) {
		console.log("gitlab-comments: the repository is not on GitLab, nothing to fetch");
	} else {
		try {
			data = await fetchGitLabComments({
				apiUrl: meta.apiUrl,
				project: meta.repo,
				token: process.env.GITLAB_TOKEN,
			});
			const n = Object.values(data).reduce((sum, t) => sum + t.comments.length, 0);
			console.log(`gitlab-comments: ${n} comments on ${Object.keys(data).length} posts`);
		} catch (e) {
			console.warn(
				`gitlab-comments: could not read comments from GitLab (${e.message}); the site builds without them`,
			);
		}
	}
	mkdirSync(dirname(outFile), { recursive: true });
	writeFileSync(
		outFile,
		JSON.stringify({
			provider: meta.provider,
			project: meta.repo,
			webUrl: meta.webUrl,
			posts: data,
		}),
	);
}
