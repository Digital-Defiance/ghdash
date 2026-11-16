// The git hosts the studio can commit to, behind one interface the controller uses:
//
//   provider.checkAccess(token)                -> { canPush }
//   provider.getHead(token)                    -> sha of the branch head
//   provider.readJsonFiles(token, ref, prefix) -> Map(path below prefix -> text) of every .json file
//   provider.commitFiles({ token, files, message, expectedHeadSha }) -> { ok, commitSha } | { ok: false, conflict, headSha }
//   provider.describeError(e)                  -> { status, auth: boolean } for host errors, or null
//
// plus the text and links the tray shows: label, apiHost, commitUrl(sha), buildsUrl, tokenUrl, tokenHelp,
// and oauth(config): how "Sign in with ..." works for this host, or null when the site's config can't support it.
//
// `meta` comes from studio-data/content.json: { provider, repo, branch, apiUrl, webUrl }.
import * as gh from "./github-commit.js";
import * as gl from "./gitlab-commit.js";

function github(meta, fetchImpl) {
	const [owner, repo] = meta.repo.split("/");
	const apiUrl = meta.apiUrl || "https://api.github.com";
	const webUrl = meta.webUrl || "https://github.com";
	const branch = meta.branch;
	const call = async (token, path) => {
		const res = await fetchImpl(`${apiUrl}${path}`, {
			headers: {
				Accept: "application/vnd.github+json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		});
		if (!res.ok) throw new gh.GitHubError(res.status, await res.json().catch(() => null));
		return res.json();
	};
	return {
		name: "github",
		label: "GitHub",
		owner,
		repo,
		branch,
		apiHost: new URL(apiUrl).host,
		commitUrl: (sha) => `${webUrl}/${owner}/${repo}/commit/${sha}`,
		buildsUrl: `${webUrl}/${owner}/${repo}/actions`,
		tokenUrl: `${webUrl}/settings/personal-access-tokens/new`,
		oauth: (config) =>
			config.exchangeUrl
				? {
						start: { authorizeUrl: `${webUrl}/login/oauth/authorize` },
						finish: { exchangeUrl: config.exchangeUrl, label: "GitHub" },
					}
				: null,
		tokenHelp: {
			kind: "fine-grained",
			create: "Create a fine-grained token",
			access: `Repository access: only ${owner}/${repo}.`,
			permissions: "Permissions: Contents, read and write. Nothing else.",
		},
		checkAccess: (token) => gh.checkAccess({ token, owner, repo, fetchImpl, apiUrl }),
		getHead: (token) => gh.getHead({ token, owner, repo, branch, fetchImpl, apiUrl }),
		async readJsonFiles(token, ref, prefix) {
			const tree = await call(token, `/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`);
			const files = new Map();
			const blobs = tree.tree.filter(
				(n) => n.type === "blob" && n.path.startsWith(prefix) && n.path.endsWith(".json"),
			);
			for (let i = 0; i < blobs.length; i += 8) {
				// oxlint-disable-next-line no-await-in-loop -- eight requests at a time
				await Promise.all(
					blobs.slice(i, i + 8).map(async (n) => {
						const b = await call(token, `/repos/${owner}/${repo}/git/blobs/${n.sha}`);
						const bytes = Uint8Array.from(atob(b.content.replace(/\s/g, "")), (c) =>
							c.charCodeAt(0),
						);
						files.set(n.path.slice(prefix.length), new TextDecoder().decode(bytes));
					}),
				);
			}
			return files;
		},
		commitFiles: (o) => gh.commitFiles({ ...o, owner, repo, branch, fetchImpl, apiUrl }),
		describeError: (e) =>
			e instanceof gh.GitHubError ? { status: e.status, auth: e.status === 401 } : null,
	};
}

function gitlab(meta, fetchImpl) {
	const project = meta.repo;
	const apiUrl = meta.apiUrl || "https://gitlab.com/api/v4";
	const webUrl = meta.webUrl || new URL(apiUrl).origin;
	const branch = meta.branch;
	const cut = project.lastIndexOf("/");
	const opts = { apiUrl, project, fetchImpl };
	return {
		name: "gitlab",
		label: "GitLab",
		owner: project.slice(0, cut),
		repo: project.slice(cut + 1),
		branch,
		apiHost: new URL(apiUrl).host,
		commitUrl: (sha) => `${webUrl}/${project}/-/commit/${sha}`,
		buildsUrl: `${webUrl}/${project}/-/pipelines`,
		tokenUrl: `${webUrl}/-/user_settings/personal_access_tokens?name=${encodeURIComponent("GitDash studio")}&scopes=api`,
		oauth: (config) => ({
			start: { authorizeUrl: `${webUrl}/oauth/authorize`, scope: "api" },
			finish: { tokenUrl: `${webUrl}/oauth/token`, clientId: config.clientId, label: "GitLab" },
		}),
		tokenHelp: {
			kind: "personal access",
			create: "Create a personal access token",
			access: `Your account needs to be able to push to ${branch} in ${project} (Developer or Maintainer, depending on branch protection). A project access token from the project's settings works too.`,
			permissions: "Scope: api. GitLab has no narrower scope that can commit through the API.",
		},
		checkAccess: (token) => gl.checkAccess({ ...opts, token, branch }),
		getHead: (token) => gl.getHead({ ...opts, token, branch }),
		readJsonFiles: (token, ref, prefix) => gl.readJsonFiles({ ...opts, token, ref, prefix }),
		commitFiles: (o) => gl.commitFiles({ ...o, ...opts, branch }),
		describeError: (e) =>
			e instanceof gl.GitLabError ? { status: e.status, auth: e.status === 401 } : null,
	};
}

export function createProvider(meta, fetchImpl = globalThis.fetch.bind(globalThis)) {
	if ((meta.provider ?? "github") === "gitlab") return gitlab(meta, fetchImpl);
	return github(meta, fetchImpl);
}
