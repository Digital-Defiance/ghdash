# Changelog

Each entry says what changed and what a site has to do to get it. Versions are released as `pages-v*` tags on GitHub (release assets) and, once published, on npm. The tag for each version is in brackets.

To upgrade a site, change the adapter URL (or version) in its `package.json`, run `npm install`, and apply the "In your site" step if there is one.

## 0.15.0

- The `ghdash-pages` command, kept as an alias in 0.14.0, is removed. Use `gitdash-pages`.
- The studio keeps its sign-in and pending changes in the browser under `gitdash-*` names instead of `ghdash-*`. After the upgrade, editors sign in to the studio again, and pending changes made before the upgrade are not restored.
- The package source moved to `gitpages-port/adapter` in the repository, and the npm page's homepage and repository links point there.
- In your site: commit or discard pending changes in the studio before you upgrade, and replace any remaining `ghdash-pages` command with `gitdash-pages` in `package.json` scripts and workflows.

## 0.14.1

- Cloudflare Workers Builds, which is where Cloudflare now sends new Git projects, is supported next to the legacy Pages form: the build is recognised through `WORKERS_CI`, and the branch and commit come from `WORKERS_CI_BRANCH` and `WORKERS_CI_COMMIT_SHA`. `gitdash-pages add-host cloudflare` now writes a `wrangler.jsonc` that publishes `dist/client` as the Worker's static assets; `add-host cloudflare-pages` still writes the Pages `wrangler.toml`.
- In your site: nothing if you're on Cloudflare Pages already. For a new Cloudflare site, run `npx gitdash-pages add-host cloudflare`, commit the file, and follow "Hosting on Cloudflare" in the template's SETUP.md. Workers Builds doesn't tell the build the site's address, so set `SITE_URL` as a build variable.

## 0.14.0

- **GHDash is now GitDash, and this package is now `@digitaldefiance/gitdash-pages`.** `@digitaldefiance/ghdash-pages` gets no more releases. The command is `gitdash-pages`; `ghdash-pages` still works as an alias for now. The repositories moved to `Digital-Defiance/gitdash` and `Digital-Defiance/GitDash-example` (the old addresses redirect). Editors stay signed in and keep their pending changes.
- In your site, for the rename: `npm uninstall @digitaldefiance/ghdash-pages && npm install @digitaldefiance/gitdash-pages`, then replace `ghdash-pages` with `gitdash-pages` in `package.json` scripts, your workflows, every import (for example in `src/pages/studio/index.astro`, `astro.config.mjs` and your tests) and any `node_modules/@digitaldefiance/ghdash-pages/...` path.
- Hosting on GitLab Pages, Netlify and Cloudflare Pages as well as GitHub Pages. New `@digitaldefiance/gitdash-pages/host` (`siteUrl()`, `basePath()`, `repoMeta()`, `studioApiOrigin()`) works out the site address, the base path and the repository from the build environment; `gitdash-pages finish` and `studio-assets` use it.
- The studio commits to GitLab projects (gitlab.com or self-managed) through the GitLab API with a pasted token or "Sign in with GitLab" (OAuth with PKCE, no Worker; set `__STUDIO_OAUTH__ = { clientId }`). Each changed file carries its last commit, so a commit is refused if someone changed one of those files first. The studio is behind a provider interface (`studio/providers.js`) that GitHub uses too. The tray's links and token help follow the host.
- On Netlify, Cloudflare Pages and GitLab Pages, redirects become a `_redirects` file with real 301/302 responses.
- `studio-assets` stops a hosted build when it can't tell which repository to commit to (set `STUDIO_REPO`), instead of shipping a studio that can't save.
- Comments from GitLab issues for repositories on GitLab: `gitdash-pages gitlab-comments` writes `.gitdash/gitlab-comments.json` for the site's comment component.
- `gitdash-pages add-host <netlify|cloudflare|gitlab>` writes `netlify.toml`, `wrangler.toml` or `.gitlab-ci.yml`.
- In your site: nothing for GitHub Pages. For another host, use `siteUrl()` and `basePath()` in `astro.config.mjs`, add `studioApiOrigin()` to the studio page's `connect-src`, and run `add-host`; see "Hosts" in the README.

## 0.13.2

- Fixed: creating a new content type (collection) in the studio failed with "Failed to create collection". The empty database the studio starts from had lost a row EmDash needs when it adds a collection. Rebuild the site to pick up the fix.

## 0.13.1 [adapter-v0.13.1]
- `import-markdown` now also lists the images it copies in the studio's media library, so imported posts' images can be found, reused and deleted there. The package page links to the repository's `main` branch.
- In your site: nothing. Run the importer again on a fresh checkout to get the library entries; images imported earlier can be added by uploading them in the studio.

## 0.13.0 [adapter-v0.13.0]
- Optional "Sign in with GitHub" in the studio, with a token-exchange Worker (`worker/github-oauth.mjs`) that holds your GitHub App's client secret. Uses PKCE and a one-time state. Off unless `globalThis.__STUDIO_OAUTH__` is set; pasting a token still works.
- In your site: nothing, unless you want the button; see "Sign in with GitHub" in the README.

## 0.12.1 [adapter-v0.12.1]
- Published to npm from GitHub Actions with provenance, so `npm install @digitaldefiance/ghdash-pages` works without a release URL. No code changes.
- In your site: optionally replace the release URL in `package.json` with `^0.12.1` and run `npm install`.

## 0.12.0 [pages-v0.17.0]
- The package is renamed from `@digital-defiance/ghdash-pages` to `@digitaldefiance/ghdash-pages`, to match the npm scope it is published under. The release file is now `digitaldefiance-ghdash-pages-<version>.tgz`.
- In your site: change the dependency name and URL in `package.json`, and every import of `@digital-defiance/ghdash-pages/...` (for example in `src/pages/studio/index.astro` and your tests) to `@digitaldefiance/ghdash-pages/...`, then run `npm install`.

## 0.11.0 [pages-v0.16.0]
- New `import-markdown` command: brings a Jekyll site or a folder of Markdown into `content/`.
- In your site: nothing required.

## 0.10.0 [pages-v0.15.0]
- Browser before-save hooks (`beforeSave` on a plugin entry in `__STUDIO_PLUGINS__`) and plugin cron jobs (`run-cron`).
- In your site: for cron, copy the `cron` job from the example `pages.yml`. Otherwise nothing required.

## 0.9.0 [pages-v0.14.0]
- Images inserted in the editor now show inside the studio, through a service worker that `studio-assets` writes to `public/studio/media-sw.js`.
- In your site: add `public/studio/media-sw.js` to `.gitignore` (it is generated at build time).

## 0.8.0 [pages-v0.13.0]
- `finish` makes WebP copies of wide images and adds a `srcset` to image tags.
- In your site: nothing required. Set `RESPONSIVE_WIDTHS=` to turn it off.

## 0.7.2 [pages-v0.12.2] and 0.7.1 [pages-v0.12.1]
- Encrypted plugin secret settings and plugin state tables are no longer written to `content/`.
- In your site: delete a `content/_plugin_state.json` file if an earlier export created one.

## 0.7.0 [pages-v0.12.0]
- Plugin after-hooks run in the Action (`run-hooks`, `hooks.config.json`).
- In your site: add `hooks.config.json` and the `hooks` job from the example `pages.yml`.

## 0.6.0 [pages-v0.11.0]
- Plugin screens and field widgets show in the studio. Schema changes saved in the browser are restored when the studio reloads.
- In your site: add `src/studio-plugins.ts` and import it before the studio boot script (see the README).

## 0.5.0 [pages-v0.10.0]
- The studio sign-in explains the GitHub token. The studio page ships a content security policy.
- In your site: move the inline script in `studio/index.astro` to `public/studio/paths.js` and use the CSP from the example.

## 0.4.0 [pages-v0.9.0]
- `copy-media` downscales images wider than `MEDIA_MAX_WIDTH` (default 2000 px).
- In your site: nothing required. Needs `sharp`, which Astro installs.

## 0.3.0 [pages-v0.8.0]
- Revisions are stored one file per row in `content/revisions/`. An older single `revisions.json` is still read.
- In your site: run `npx ghdash-pages split-revisions content` once and commit the result.

## 0.2.0 and earlier [pages-v0.7.0 and before]
- The studio (boot, pending-changes tray, commit code), scheduled publishing, pagination, Pagefind search, giscus comments and the build commands, first released as this package.
