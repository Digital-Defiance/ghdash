// Multi-file commits from the browser to a GitLab project with a personal, project or group access token (scope `api`).
// Runs unchanged in a browser or Node 18+ (uses global fetch, btoa, TextEncoder). GitLab's API sends CORS headers, so no proxy is needed.
//
//   const r = await commitFiles({ token, apiUrl: "https://gitlab.com/api/v4", project: "group/site", branch: "main",
//     expectedHeadSha, message, files: { "content/ec_posts/01J.json": "{...}", "media/2026/11/a.png": uint8array, "old.json": null } });
//   r = { ok: true, commitSha } | { ok: false, conflict: true, headSha } | throws GitLabError
//
// GitLab's commits API has no compare-and-swap on the branch head, so the head is checked just before committing.
// A push that lands in the moment between the check and the commit is not detected, and the commit is placed on top of it.
export class GitLabError extends Error {
	constructor(status, body) {
		const detail = body?.message ?? body?.error ?? "";
		super(`GitLab API ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
		this.status = status;
		this.body = body;
	}
}

const DEFAULT_API = "https://gitlab.com/api/v4";

function client({ token, apiUrl = DEFAULT_API, fetchImpl = globalThis.fetch }) {
	const call = async (method, path, body, raw = false) => {
		const res = await fetchImpl(`${apiUrl}${path}`, {
			method,
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!res.ok) throw new GitLabError(res.status, await res.json().catch(() => null));
		if (raw) return res;
		return res.status === 204 ? null : res.json().catch(() => null);
	};
	return call;
}

const pid = (project) => encodeURIComponent(project);

function toBase64(bytes) {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

/** Checks the token can read the project and push to the branch. Branch protection is taken into account. */
export async function checkAccess({ token, apiUrl, project, branch, fetchImpl }) {
	const gl = client({ token, apiUrl, fetchImpl });
	const p = await gl("GET", `/projects/${pid(project)}`);
	const b = await gl(
		"GET",
		`/projects/${pid(project)}/repository/branches/${encodeURIComponent(branch ?? p.default_branch)}`,
	);
	return { canPush: Boolean(b.can_push), defaultBranch: p.default_branch };
}

export async function getHead({ token, apiUrl, project, branch, fetchImpl }) {
	const b = await client({ token, apiUrl, fetchImpl })(
		"GET",
		`/projects/${pid(project)}/repository/branches/${encodeURIComponent(branch)}`,
	);
	return b.commit.id;
}

/** Lists blobs under `path` at `ref` as [{ path, id }]. A missing directory gives []. */
export async function listTree({
	token,
	apiUrl,
	project,
	ref,
	path,
	recursive = false,
	fetchImpl,
}) {
	const gl = client({ token, apiUrl, fetchImpl });
	const out = [];
	for (let page = 1; page;) {
		const q = new URLSearchParams({
			ref,
			path,
			recursive: String(recursive),
			per_page: "100",
			page: String(page),
		});
		let res;
		try {
			// oxlint-disable-next-line no-await-in-loop -- pages are fetched in order
			res = await gl("GET", `/projects/${pid(project)}/repository/tree?${q}`, undefined, true);
		} catch (e) {
			if (e instanceof GitLabError && e.status === 404) return out;
			throw e;
		}
		// oxlint-disable-next-line no-await-in-loop -- pages are fetched in order
		for (const n of await res.json()) if (n.type === "blob") out.push({ path: n.path, id: n.id });
		page = Number(res.headers.get("x-next-page")) || 0;
	}
	return out;
}

/** Reads the text of every `.json` file under `prefix` at `ref`, as a Map keyed by path relative to `prefix`. */
export async function readJsonFiles({ token, apiUrl, project, ref, prefix, fetchImpl }) {
	const gl = client({ token, apiUrl, fetchImpl });
	const blobs = (
		await listTree({
			token,
			apiUrl,
			project,
			ref,
			path: prefix.replace(/\/$/, ""),
			recursive: true,
			fetchImpl,
		})
	).filter((n) => n.path.endsWith(".json"));
	const files = new Map();
	for (let i = 0; i < blobs.length; i += 8) {
		// oxlint-disable-next-line no-await-in-loop -- eight requests at a time
		await Promise.all(
			blobs.slice(i, i + 8).map(async (n) => {
				const res = await gl(
					"GET",
					`/projects/${pid(project)}/repository/blobs/${n.id}/raw`,
					undefined,
					true,
				);
				files.set(n.path.slice(prefix.length), await res.text());
			}),
		);
	}
	return files;
}

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export async function commitFiles({
	token,
	apiUrl,
	project,
	branch,
	files,
	message,
	expectedHeadSha,
	fetchImpl,
}) {
	const gl = client({ token, apiUrl, fetchImpl });
	const headSha = await getHead({ token, apiUrl, project, branch, fetchImpl });
	if (expectedHeadSha && expectedHeadSha !== headSha) return { ok: false, conflict: true, headSha };

	// GitLab needs "create" or "update" per file, so look up which written files exist, one listing per directory.
	const written = Object.entries(files).filter(([, c]) => c !== null);
	const existing = new Set();
	for (const dir of new Set(written.map(([p]) => dirOf(p)))) {
		// oxlint-disable-next-line no-await-in-loop -- one directory at a time keeps within rate limits
		for (const n of await listTree({ token, apiUrl, project, ref: headSha, path: dir, fetchImpl }))
			existing.add(n.path);
	}
	const actions = Object.entries(files).map(([path, content]) => {
		if (content === null) return { action: "delete", file_path: path };
		const action = existing.has(path) ? "update" : "create";
		return typeof content === "string"
			? { action, file_path: path, content }
			: { action, file_path: path, content: toBase64(content), encoding: "base64" };
	});
	try {
		const commit = await gl("POST", `/projects/${pid(project)}/repository/commits`, {
			branch,
			commit_message: message,
			actions,
		});
		return { ok: true, commitSha: commit.id };
	} catch (e) {
		// 400 "A file with this name already exists" / "doesn't exist": the tree changed after we looked.
		if (e instanceof GitLabError && e.status === 400) {
			const now = await getHead({ token, apiUrl, project, branch, fetchImpl });
			if (now !== headSha) return { ok: false, conflict: true, headSha: now };
		}
		throw e;
	}
}
