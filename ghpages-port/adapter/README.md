# @digitaldefiance/ghdash-pages

Build-side commands for an EmDash site that is published to GitHub Pages, GitLab Pages, Netlify or Cloudflare Pages, with its content kept as JSON in the repository (`content/`). The studio commits to GitHub or GitLab. Run the commands from the site's root.

```
ghdash-pages build-db            content/*.json -> data.db (needs `emdash` in the site)
ghdash-pages publish-due         publish scheduled entries that are due and update content/ (after fetch-browser-api)
ghdash-pages run-hooks --base <sha> --head <sha>  run plugin after-hooks for content that changed between two commits (reads hooks.config.json)
ghdash-pages due                 prints true or false: is a scheduled entry due? (for a scheduled workflow)
ghdash-pages studio-assets       public/studio-data/ for the in-browser admin
ghdash-pages fetch-browser-api   public/studio-api/ from a pages-v* release (BROWSER_API_TAG, BROWSER_API_URL, BROWSER_API_DIR)
ghdash-pages copy-media          media/ -> public/media/, downscaling images wider than MEDIA_MAX_WIDTH (default 2000, 0 = off; needs sharp, which Astro installs)
ghdash-pages finish [dist]       after `astro build`: base path, media URLs, responsive images (WebP + srcset), redirect pages (BASE_PATH)
ghdash-pages run-cron [--since <iso>]  run plugin cron jobs that fell due (reads hooks.config.json)
ghdash-pages import-markdown <dir>  bring a Jekyll site or Markdown folder into content/ (--dry-run first)
ghdash-pages export-content      data.db -> content/
ghdash-pages split-revisions     one-off: content/revisions.json -> content/revisions/<id>.json (older sites)
ghdash-pages serve               serve dist/client under BASE_PATH, like Pages
ghdash-pages add-host <netlify|cloudflare|gitlab>  write netlify.toml, wrangler.toml or .gitlab-ci.yml for the site
```

A typical site build script:

```
ghdash-pages build-db && ghdash-pages fetch-browser-api && ghdash-pages publish-due && ghdash-pages studio-assets && ghdash-pages copy-media && astro build && ghdash-pages finish && pagefind --site dist/client
```

## Importing an existing site

`ghdash-pages import-markdown <dir>` imports a Jekyll site or any folder of Markdown files into `content/`. Run it from your GHDash site's root, review the result with `git diff`, then commit.

```
npx ghdash-pages import-markdown ../my-jekyll-site --dry-run   # list what it found
npx ghdash-pages import-markdown ../my-jekyll-site
```

- Files under `_posts` or named `YYYY-MM-DD-name.md` become posts, files under `_drafts` become drafts, everything else becomes a page. `published: false` makes a draft.
- Front matter `title`, `date`, `slug`, `tags`, `categories`, `description` or `excerpt` are used. A missing title comes from the first `# heading`, then from the file name. Dates are kept as the publish date.
- Tags and categories are created if they don't exist. Local images (relative paths or `/assets/...` under `--root`, default the folder itself) are copied to `media/` and linked.
- Simple Liquid (`{{ site.baseurl }}`, `relative_url`, `raw`, `highlight`) is converted. Other Liquid tags are removed and counted in a warning, because they have no static equivalent.
- It uses EmDash's own content handlers, so slugs, revisions, taxonomies and search work as if you had written the entries in the studio. Entries whose slug already exists are skipped, so running it twice is safe.
- Options: `--root <dir>` (where `/assets/...` images live), `--posts <collection>` and `--pages <collection>` (default `posts` and `pages`), `--dry-run`.

Imported images are not listed in the studio's media library yet, but they display on the site and in the editor. Front matter other than the fields above (custom layouts, permalinks) is ignored.

## Sign in with GitHub

By default an editor pastes a fine-grained token into the studio. To offer a "Sign in with GitHub" button as well, set up a GitHub App and the small token-exchange Worker in `worker/github-oauth.mjs`. GitHub's token endpoint needs the app's client secret and does not allow browser requests, so something has to hold the secret. The Worker stores nothing, logs nothing, accepts requests only from your site and only for your site's addresses, and returns just the token. The token path keeps working.

1. On GitHub, Settings, Developer settings, GitHub Apps, **New GitHub App**. Callback URL: the studio address, for example `https://you.github.io/your-repo/studio/`. Untick Webhook. Repository permissions: Contents, read and write. Create it, note the **Client ID**, and generate a **client secret**.
2. Install the app on your site's repository (the app's **Install App** tab). The sign-in token can then only reach repositories that the editor can write to and the app is installed on.
3. Deploy the Worker from your site: `npx wrangler deploy node_modules/@digitaldefiance/ghdash-pages/worker/github-oauth.mjs --name ghdash-sign-in --var ALLOWED_ORIGIN:https://you.github.io --var GITHUB_CLIENT_ID:<client id>`, then `npx wrangler secret put GITHUB_CLIENT_SECRET --name ghdash-sign-in` and paste the secret at the prompt. Never put the secret in a file, a commit or a chat.
4. In your `/studio/` page, set `globalThis.__STUDIO_OAUTH__ = { clientId: "<client id>", exchangeUrl: "https://ghdash-sign-in.<you>.workers.dev/" }` before loading the studio. The client ID and the Worker address are public.

GitHub App tokens expire after eight hours by default, after which the studio asks the editor to sign in again. Pending edits are kept in the browser meanwhile.

## Responsive images

`finish` makes 480, 960 and 1600 px WebP copies of each JPEG or PNG under `media/` that is wider than the copy, and adds a `srcset` and `sizes="100vw"` to built `<img>` tags that point at it. The original stays as the `src` and as the largest candidate. Tags that already have a `srcset`, and small images, are left alone. It needs `sharp` and does nothing without it. Set `RESPONSIVE_WIDTHS=480,800` to choose the widths, `RESPONSIVE_WIDTHS=` to turn it off, and `RESPONSIVE_SIZES` to change the `sizes` value for a narrower layout.

## Hosts: GitHub Pages, GitLab Pages, Netlify, Cloudflare Pages

`@digitaldefiance/ghdash-pages/host` reads the build environment and says where the site is served and where its repository is. Use it in `astro.config.mjs` so the same site builds on every host:

```js
import { basePath, siteUrl } from "@digitaldefiance/ghdash-pages/host";
export default defineConfig({ site: siteUrl(), base: basePath(), output: "static" /* ... */ });
```

| Host             | Address and base path                                                                            | Repository the studio commits to                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Pages     | `SITE_URL` and `BASE_PATH` from the workflow (`actions/configure-pages`)                         | `GITHUB_REPOSITORY`                                                                                                            |
| GitLab Pages     | `CI_PAGES_URL`: `/<project>` for a project site, `/` for a unique domain or custom domain        | `CI_PROJECT_PATH` on `CI_API_V4_URL`, so self-managed GitLab works                                                             |
| Netlify          | `URL` (production) or `DEPLOY_PRIME_URL` (previews and branches), always `/`                     | `REPOSITORY_URL`, GitHub or GitLab                                                                                             |
| Cloudflare Pages | `CF_PAGES_URL` (this deployment's own address; set `SITE_URL` to the production one), always `/` | the `origin` remote, or `STUDIO_REPO` (and `STUDIO_PROVIDER=gitlab`), because Cloudflare doesn't say which repository it built |
| Local            | `SITE_URL`, `BASE_PATH`                                                                          | the `origin` remote                                                                                                            |

`SITE_URL`, `BASE_PATH`, `GHDASH_HOST` (`github-pages`, `gitlab-pages`, `netlify`, `cloudflare-pages`) and `STUDIO_PROVIDER` (`github`, `gitlab`), `STUDIO_REPO`, `STUDIO_BRANCH`, `STUDIO_API_URL`, `STUDIO_WEB_URL` override the guesses. `ghdash-pages finish` uses the same base path. On Netlify, Cloudflare Pages and GitLab Pages, redirects are written to a `_redirects` file and are real 301/302 responses; on GitHub Pages they stay HTML forwarding pages.

`ghdash-pages add-host netlify` writes a `netlify.toml`, `ghdash-pages add-host cloudflare` a `wrangler.toml` (the build command and variables are set in the Cloudflare dashboard; the file lists them), and `ghdash-pages add-host gitlab` a `.gitlab-ci.yml` that builds and publishes with GitLab Pages, publishes scheduled posts from a pipeline schedule, and runs plugin after-hooks and cron. The studio page's Content-Security-Policy must allow the git host's API: `studioApiOrigin()` from the same module gives it (`https://api.github.com`, `https://gitlab.com`, or your GitLab's address).

### Committing to GitLab

On GitLab the studio commits through GitLab's REST API, which allows browser requests, so no proxy is needed. Editors paste a personal access token with the `api` scope (GitLab has no narrower scope that can commit through the API); a project access token works too. The token must be allowed to push to the branch, so with the default branch protection that means Maintainer. Conflicts are caught as on GitHub: the branch head is checked before committing, and every changed or deleted file carries its last commit, so GitLab refuses the commit if someone changed one of those files in the meantime.

"Sign in with GitLab" needs no Worker, because GitLab's token endpoint allows browser requests. Register an application in GitLab (User settings → Applications, or the group's or instance's), untick **Confidential**, tick the **api** scope, and set the redirect URI to the site's `/studio/` address. Then set `globalThis.__STUDIO_OAUTH__ = { clientId }` before the studio loads. GitLab tokens from this flow last two hours; then the editor signs in again.

## Install and upgrade

From npm: `npm install @digitaldefiance/ghdash-pages`. Maintainers: publish the first version by hand from `ghpages-port/adapter` (`npm login`, then `npm publish --access public`), then add a Trusted Publisher on the package's npm settings page (GitHub Actions, organization `Digital-Defiance`, repository `ghdash`, workflow `publish-adapter.yml`). After that, pushing a tag `adapter-v<version>` publishes it with provenance and no token. From a GitHub release (what the example site uses): point the dependency at the release asset, for example `https://github.com/Digital-Defiance/ghdash/releases/download/pages-v0.17.0/digitaldefiance-ghdash-pages-0.12.0.tgz`. `CHANGELOG.md` lists, for each version, what changed and what a site has to do. The admin and core builds the studio needs are also release assets, because they are patched builds of EmDash's own packages and can't be published under its npm names.

## The in-browser studio

`@digitaldefiance/ghdash-pages/studio/boot.tsx` mounts the real EmDash admin in the browser, with a pending-changes tray. A site needs a page at `/studio/` that sets `__EMDASH_PATHS__` and loads it:

```astro
<script is:inline>
	const site = location.pathname.replace(/\/studio(\/.*)?$/, "");
	globalThis.__EMDASH_PATHS__ = { adminBase: site + "/studio", apiBase: site + "/_api", siteBase: site + "/" };
</script>
<div id="admin-root"></div>
<script>import "@digitaldefiance/ghdash-pages/studio/boot.tsx";</script>
```

The site must also depend on `@emdash-cms/admin` (the `pages-v*` release build), `@sqlite.org/sqlite-wasm`, `react` and `react-dom`. Also exported: `studio/tray.js`, `studio/load-db.js`, `studio/controller.js`, `studio/providers.js`, `studio/github-commit.js` and `studio/gitlab-commit.js`.

The Pagefind search page and the page templates are part of the site template. See `GHDash-example` for a working site.

## Plugins in the studio

The studio can show plugin screens and field widgets. Before the boot script, set `globalThis.__STUDIO_PLUGINS__`:

```ts
// src/studio-plugins.ts, imported just before the studio boot script in studio/index.astro
import * as colorAdmin from "@emdash-cms/plugin-color/admin";

(globalThis as any).__STUDIO_PLUGINS__ = {
	// What the admin's manifest needs from each plugin definition (see its createPlugin()).
	plugins: [
		{
			id: "color",
			version: "0.2.1",
			admin: {
				entry: "@emdash-cms/plugin-color/admin",
				fieldWidgets: [{ name: "picker", label: "Color Picker", fieldTypes: ["string"] }],
			},
		},
	],
	// The plugin's admin module, as the plugin exports it from its `admin` entry.
	admins: { color: colorAdmin },
};
```

Only the admin side runs in the browser. Plugin routes and server hooks do not run in the studio. A site can opt a plugin into one browser-side hook, `beforeSave`.

### Before-save hooks in the studio

Add a plain browser function to the plugin's entry in `__STUDIO_PLUGINS__.plugins`. It runs before every content create and update made in the studio. Return the data to save, or nothing to keep it, or throw to refuse the save and show the editor your message:

```ts
plugins: [
	{
		id: "title-rules",
		beforeSave: ({ data, collection, isNew, id }) => {
			if (!String(data.title ?? "").trim())
				throw Object.assign(new Error("A title is required"), { name: "SaveRejected" });
			return { ...data, title: String(data.title).trim() };
		},
	},
];
```

This is code you write for the site, not the plugin's own server hook, which expects a server. Any other error becomes a generic "A plugin hook failed" message and is logged to the console. Requires the browser API from release `pages-v0.15.0` or later.

### What works for each plugin

| Plugin             | In the studio                                                                         | On the published site                                                                                       | Doesn't work                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `color`            | Color picker field widget                                                             | Values are stored as plain field data and render with your templates                                        | Nothing known                                                                          |
| `field-kit`        | Its field widgets                                                                     | Values are plain field data                                                                                 | Nothing known                                                                          |
| `embeds`           | Block types in the editor, with the insert dialog                                     | Rendered at build time; add `embedsPlugin()` to the `emdash({ plugins: [...] })` list in `astro.config.mjs` | Without that line the blocks save fine but don't render on the site                    |
| `webhook-notifier` | Not usable: its settings screen is a plugin route, and routes don't run in the studio | `content:afterSave` and `content:afterDelete` run in the Action (see below)                                 | Configure it in `hooks.config.json` with secrets in Actions secrets, not in the studio |

Two limits apply to every plugin. Public plugin HTTP routes don't exist on Pages, because there is no server. Encrypted secret settings can't be saved in the studio, since the browser has no encryption key, and they are never written to `content/`.

## Plugin cron in the build Action

`ghdash-pages run-cron` runs the `cron` hook of plugins in `hooks.config.json` that list `cron` jobs, for each job that fell due since the last run. Schedules are 5-field cron expressions in UTC or `@hourly`, `@daily`, `@weekly`:

```json
{
	"id": "digest",
	"module": "my-plugin/sandbox",
	"cron": [{ "name": "weekly-digest", "schedule": "0 9 * * 1", "data": { "to": "team" } }]
}
```

The hook gets `{ name, data, scheduledAt }` and the same in-memory context as after-hooks (settings and secrets from the environment, `http.fetch`, no content or media access). A job that fired more than once since the last run runs once, with its latest time. The workflow's hourly schedule drives it, so a job fires within about an hour of its time, and the `cron-last` tag remembers the last successful run. The plugins in this repo that use cron (`forms`, `ai-search`) need routes or content access and can't run here.

## Plugin after-hooks in the build Action

`ghdash-pages run-hooks --base <sha> --head <sha>` runs the `content:afterSave` and `content:afterDelete` hooks of the plugins in `hooks.config.json` for each content file that changed between the commits (added or modified: save, with `isNew` for added files; deleted or soft-deleted: delete).

```json
{
	"site": { "name": "My site", "url": "https://owner.github.io/repo/" },
	"plugins": [
		{
			"id": "webhook-notifier",
			"module": "@emdash-cms/plugin-webhook-notifier/sandbox",
			"settings": {
				"webhookUrl": { "env": "WEBHOOK_URL" },
				"secretToken": { "env": "WEBHOOK_TOKEN" },
				"enabled": true
			}
		}
	]
}
```

`{ "env": "NAME" }` reads the value from the environment (use Actions secrets); a variable that is not set leaves the setting unset. The hook gets `kv` and `settings` seeded from these values, in-memory `storage`, `http.fetch` and `log`. Content, media and schema access are not provided, and nothing a plugin stores outlives the run. Media uploads do not trigger `media:afterUpload`. The programmatic API is `@digitaldefiance/ghdash-pages/hooks`.
