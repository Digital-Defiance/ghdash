# @digital-defiance/ghdash-pages

Build-side commands for an EmDash site that is published to GitHub Pages, with its content kept as JSON in the repository (`content/`). Run them from the site's root.

```
ghdash-pages build-db            content/*.json -> data.db (needs `emdash` in the site)
ghdash-pages publish-due         publish scheduled entries that are due and update content/ (after fetch-browser-api)
ghdash-pages run-hooks --base <sha> --head <sha>  run plugin after-hooks for content that changed between two commits (reads hooks.config.json)
ghdash-pages due                 prints true or false: is a scheduled entry due? (for a scheduled workflow)
ghdash-pages studio-assets       public/studio-data/ for the in-browser admin
ghdash-pages fetch-browser-api   public/studio-api/ from a pages-v* release (BROWSER_API_TAG, BROWSER_API_URL, BROWSER_API_DIR)
ghdash-pages copy-media          media/ -> public/media/, downscaling images wider than MEDIA_MAX_WIDTH (default 2000, 0 = off; needs sharp, which Astro installs)
ghdash-pages finish [dist]       after `astro build`: base path, media URLs, redirect pages (BASE_PATH)
ghdash-pages export-content      data.db -> content/
ghdash-pages split-revisions     one-off: content/revisions.json -> content/revisions/<id>.json (older sites)
ghdash-pages serve               serve dist/client under BASE_PATH, like Pages
```

A typical site build script:

```
ghdash-pages build-db && ghdash-pages fetch-browser-api && ghdash-pages publish-due && ghdash-pages studio-assets && ghdash-pages copy-media && astro build && ghdash-pages finish && pagefind --site dist/client
```

## The in-browser studio

`@digital-defiance/ghdash-pages/studio/boot.tsx` mounts the real EmDash admin in the browser, with a pending-changes tray. A site needs a page at `/studio/` that sets `__EMDASH_PATHS__` and loads it:

```astro
<script is:inline>
	const site = location.pathname.replace(/\/studio(\/.*)?$/, "");
	globalThis.__EMDASH_PATHS__ = { adminBase: site + "/studio", apiBase: site + "/_api", siteBase: site + "/" };
</script>
<div id="admin-root"></div>
<script>import "@digital-defiance/ghdash-pages/studio/boot.tsx";</script>
```

The site must also depend on `@emdash-cms/admin` (the `pages-v*` release build), `@sqlite.org/sqlite-wasm`, `react` and `react-dom`. Also exported: `studio/tray.js`, `studio/load-db.js`, `studio/controller.js` and `studio/github-commit.js`.

The Pagefind search page and the page templates are part of the site template. See `GHDash-example` for a working site.

## Plugins in the studio

The studio can show plugin screens and field widgets. Before the boot script, set `globalThis.__STUDIO_PLUGINS__`:

```ts
// src/studio-plugins.ts, imported just before the studio boot script in studio/index.astro
import * as colorAdmin from "@emdash-cms/plugin-color/admin";

(globalThis as any).__STUDIO_PLUGINS__ = {
	// What the admin's manifest needs from each plugin definition (see its createPlugin()).
	plugins: [{ id: "color", version: "0.2.1", admin: { entry: "@emdash-cms/plugin-color/admin", fieldWidgets: [{ name: "picker", label: "Color Picker", fieldTypes: ["string"] }] } }],
	// The plugin's admin module, as the plugin exports it from its `admin` entry.
	admins: { color: colorAdmin },
};
```

Only the admin side runs in the browser. Plugin hooks and routes do not run in the studio.

## Plugin after-hooks in the build Action

`ghdash-pages run-hooks --base <sha> --head <sha>` runs the `content:afterSave` and `content:afterDelete` hooks of the plugins in `hooks.config.json` for each content file that changed between the commits (added or modified: save, with `isNew` for added files; deleted or soft-deleted: delete).

```json
{
	"site": { "name": "My site", "url": "https://owner.github.io/repo/" },
	"plugins": [
		{
			"id": "webhook-notifier",
			"module": "@emdash-cms/plugin-webhook-notifier/sandbox",
			"settings": { "webhookUrl": { "env": "WEBHOOK_URL" }, "secretToken": { "env": "WEBHOOK_TOKEN" }, "enabled": true }
		}
	]
}
```

`{ "env": "NAME" }` reads the value from the environment (use Actions secrets); a variable that is not set leaves the setting unset. The hook gets `kv` and `settings` seeded from these values, in-memory `storage`, `http.fetch` and `log`. Content, media and schema access are not provided, and nothing a plugin stores outlives the run. Media uploads do not trigger `media:afterUpload`. The programmatic API is `@digital-defiance/ghdash-pages/hooks`.
