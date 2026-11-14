// Spike: atomic multi-file commit from the browser with a fine-grained PAT, via the Git Data API.
// Runs unchanged in a browser or Node 18+ (uses global fetch, btoa, TextEncoder).
//
//   const r = await commitFiles({ token, owner, repo, branch: "main",
//     expectedHeadSha,                         // head the admin loaded from; omit to skip the check
//     message: "Update post: Hello",
//     files: { "content/ec_posts/01J.json": "{...}", "media/2026/11/a.png": uint8array, "old.json": null },
//   });
//   r = { ok: true, commitSha } | { ok: false, conflict: true, headSha } | throws on other errors
export class GitHubError extends Error {
	constructor(status, body) {
		super(`GitHub API ${status}: ${body?.message ?? ""}`);
		this.status = status;
		this.body = body;
	}
}

function client(token, fetchImpl = globalThis.fetch) {
	return async (method, path, body) => {
		const res = await fetchImpl(`https://api.github.com${path}`, {
			method,
			headers: {
				Accept: "application/vnd.github+json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				"X-GitHub-Api-Version": "2022-11-28",
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		const json = res.status === 204 ? null : await res.json().catch(() => null);
		if (!res.ok) throw new GitHubError(res.status, json);
		return json;
	};
}

function toBase64(bytes) {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

export async function checkAccess({ token, owner, repo, fetchImpl }) {
	const r = await client(token, fetchImpl)("GET", `/repos/${owner}/${repo}`);
	return { canPush: Boolean(r.permissions?.push), defaultBranch: r.default_branch };
}

export async function getHead({ token, owner, repo, branch, fetchImpl }) {
	const ref = await client(token, fetchImpl)("GET", `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
	return ref.object.sha;
}

export async function commitFiles({ token, owner, repo, branch, files, message, expectedHeadSha, fetchImpl }) {
	const gh = client(token, fetchImpl);
	const base = `/repos/${owner}/${repo}/git`;
	const headSha = (await gh("GET", `${base}/ref/heads/${branch}`)).object.sha;
	if (expectedHeadSha && expectedHeadSha !== headSha) return { ok: false, conflict: true, headSha };

	const headCommit = await gh("GET", `${base}/commits/${headSha}`);
	const tree = [];
	for (const [path, content] of Object.entries(files)) {
		if (content === null) {
			tree.push({ path, mode: "100644", type: "blob", sha: null });
		} else if (typeof content === "string") {
			tree.push({ path, mode: "100644", type: "blob", content });
		} else {
			const blob = await gh("POST", `${base}/blobs`, { content: toBase64(content), encoding: "base64" });
			tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
		}
	}
	const newTree = await gh("POST", `${base}/trees`, { base_tree: headCommit.tree.sha, tree });
	const commit = await gh("POST", `${base}/commits`, { message, tree: newTree.sha, parents: [headSha] });
	try {
		await gh("PATCH", `${base}/refs/heads/${branch}`, { sha: commit.sha, force: false });
	} catch (e) {
		// 422 "Update is not a fast forward": someone pushed between our read and our write.
		if (e instanceof GitHubError && e.status === 422) {
			return { ok: false, conflict: true, headSha: await getHead({ token, owner, repo, branch, fetchImpl }) };
		}
		throw e;
	}
	return { ok: true, commitSha: commit.sha };
}
