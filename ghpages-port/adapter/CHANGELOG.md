# Changelog

Each entry says what changed and what a site has to do to get it. Versions are released as `pages-v*` tags on GitHub (release assets) and, once published, on npm. The tag for each version is in brackets.

To upgrade a site, change the adapter URL (or version) in its `package.json`, run `npm install`, and apply the "In your site" step if there is one.

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
