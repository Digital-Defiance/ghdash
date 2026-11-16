// Works out where the site is hosted and where its repository lives, from the build environment.
// Hosts: GitHub Pages (GitHub Actions), GitLab Pages (GitLab CI), Netlify and Cloudflare Pages (both building from GitHub or GitLab).
// Explicit settings always win: SITE_URL, BASE_PATH, STUDIO_PROVIDER, STUDIO_REPO, STUDIO_API_URL, STUDIO_WEB_URL, STUDIO_BRANCH.
//
//   import { siteUrl, basePath, repoMeta } from "@digitaldefiance/ghdash-pages/host";
//   export default defineConfig({ site: siteUrl(), base: basePath(), ... });
import { execFileSync } from "node:child_process";

const trimSlash = (s) => s.replace(/\/+$/, "");

/** "netlify", "cloudflare-pages", "gitlab-pages", "github-pages" or "local". GHDASH_HOST overrides the guess. */
export function hostName(env = process.env) {
	if (env.GHDASH_HOST) return env.GHDASH_HOST;
	if (env.NETLIFY === "true") return "netlify";
	if (env.CF_PAGES === "1") return "cloudflare-pages";
	if (env.GITLAB_CI) return "gitlab-pages";
	if (env.GITHUB_ACTIONS) return "github-pages";
	return "local";
}

function netlifyUrl(env) {
	// Production builds use the site's main address; branch and preview deploys their own.
	return env.CONTEXT === "production" ? env.URL : env.DEPLOY_PRIME_URL || env.URL;
}

/** The site's public address (Astro's `site`), or undefined when it can't be told. */
export function siteUrl(env = process.env) {
	if (env.SITE_URL) return env.SITE_URL;
	const host = hostName(env);
	if (host === "netlify") return netlifyUrl(env) || undefined;
	// CF_PAGES_URL names this deployment (https://<hash>.<project>.pages.dev); set SITE_URL for the production address.
	if (host === "cloudflare-pages" && env.CF_PAGES_URL) return new URL(env.CF_PAGES_URL).origin;
	if (host === "gitlab-pages" && env.CI_PAGES_URL) return new URL(env.CI_PAGES_URL).origin;
	return undefined;
}

/**
 * The path the site is served under (Astro's `base`), without a trailing slash except for the root "/".
 * GitHub Pages project sites live under /<repo>/ and the workflow passes BASE_PATH from configure-pages.
 * GitLab Pages project sites live under /<project>/ unless the project uses a unique domain; CI_PAGES_URL says which.
 * Netlify and Cloudflare Pages always serve from the root.
 */
export function basePath(env = process.env) {
	if (env.BASE_PATH) return trimSlash(env.BASE_PATH) || "/";
	const host = hostName(env);
	if (host === "gitlab-pages" && env.CI_PAGES_URL)
		return trimSlash(new URL(env.CI_PAGES_URL).pathname) || "/";
	return "/";
}

/** basePath() as a prefix for root-absolute URLs: "" for the root, "/repo" otherwise. */
export function basePrefix(env = process.env) {
	const b = basePath(env);
	return b === "/" ? "" : b;
}

/** Parses a git remote address into { provider, webUrl, apiUrl, path }, or null. Credentials in the address are dropped. */
export function parseRemote(remote) {
	if (!remote) return null;
	let host,
		path,
		protocol = "https:";
	const scp = remote.match(/^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/);
	if (scp && !/^[a-z]+:\/\//i.test(remote)) {
		[, host, path] = scp;
	} else {
		let u;
		try {
			u = new URL(remote);
		} catch {
			return null;
		}
		host = u.host;
		path = u.pathname.replace(/^\/+/, "");
		if (u.protocol === "http:") protocol = "http:";
	}
	path = path.replace(/\.git$/, "").replace(/\/+$/, "");
	if (!path.includes("/")) return null;
	const webUrl = `${protocol}//${host.replace(/:\d+$/, (p) => (protocol === "http:" ? p : ""))}`;
	if (/^github\.com$/i.test(host))
		return {
			provider: "github",
			webUrl: "https://github.com",
			apiUrl: "https://api.github.com",
			path,
		};
	if (/gitlab/i.test(host)) return { provider: "gitlab", webUrl, apiUrl: `${webUrl}/api/v4`, path };
	return null;
}

const sh = (cmd, args) => {
	try {
		return execFileSync(cmd, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "";
	}
};

/**
 * Where the studio commits: { provider, repo, branch, head, apiUrl, webUrl }.
 * `repo` is "owner/name" on GitHub and the full project path ("group/sub/project") on GitLab.
 */
export function repoMeta(env = process.env, git = sh) {
	let found = null;
	if (env.GITLAB_CI && env.CI_PROJECT_PATH)
		found = {
			provider: "gitlab",
			path: env.CI_PROJECT_PATH,
			webUrl: trimSlash(env.CI_SERVER_URL || "https://gitlab.com"),
			apiUrl: trimSlash(
				env.CI_API_V4_URL || `${trimSlash(env.CI_SERVER_URL || "https://gitlab.com")}/api/v4`,
			),
		};
	else if (env.GITHUB_ACTIONS && env.GITHUB_REPOSITORY)
		found = {
			provider: "github",
			path: env.GITHUB_REPOSITORY,
			webUrl: trimSlash(env.GITHUB_SERVER_URL || "https://github.com"),
			apiUrl: trimSlash(env.GITHUB_API_URL || "https://api.github.com"),
		};
	else if (env.NETLIFY === "true" && env.REPOSITORY_URL) found = parseRemote(env.REPOSITORY_URL);
	found ??= parseRemote(git("git", ["remote", "get-url", "origin"]));

	const provider = env.STUDIO_PROVIDER || found?.provider || "github";
	const defaults =
		provider === "gitlab"
			? { webUrl: "https://gitlab.com", apiUrl: "https://gitlab.com/api/v4" }
			: { webUrl: "https://github.com", apiUrl: "https://api.github.com" };
	const same = found?.provider === provider;
	const webUrl = trimSlash(env.STUDIO_WEB_URL || (same ? found.webUrl : defaults.webUrl));
	const apiUrl = trimSlash(
		env.STUDIO_API_URL ||
			(same ? found.apiUrl : provider === "gitlab" ? `${webUrl}/api/v4` : defaults.apiUrl),
	);
	return {
		provider,
		repo: env.STUDIO_REPO || (same ? found.path : "") || "",
		branch:
			env.STUDIO_BRANCH ||
			env.CI_COMMIT_REF_NAME ||
			(env.NETLIFY === "true" ? env.BRANCH || env.HEAD : "") ||
			env.CF_PAGES_BRANCH ||
			env.GITHUB_REF_NAME ||
			git("git", ["branch", "--show-current"]) ||
			"main",
		head:
			env.CI_COMMIT_SHA ||
			(env.NETLIFY === "true" ? env.COMMIT_REF : "") ||
			env.CF_PAGES_COMMIT_SHA ||
			env.GITHUB_SHA ||
			git("git", ["rev-parse", "HEAD"]),
		apiUrl,
		webUrl,
	};
}

/** The origin the studio's Content-Security-Policy must allow in connect-src for commits. */
export function studioApiOrigin(env = process.env, git = sh) {
	return new URL(repoMeta(env, git).apiUrl).origin;
}
