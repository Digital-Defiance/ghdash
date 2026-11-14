# @digital-defiance/ghdash-pages

Build-side commands for an EmDash site that is published to GitHub Pages, with its content kept as JSON in the repository (`content/`). Run them from the site's root.

```
ghdash-pages build-db            content/*.json -> data.db (needs `emdash` in the site)
ghdash-pages publish-due         publish scheduled entries that are due and update content/ (after fetch-browser-api)
ghdash-pages due                 prints true or false: is a scheduled entry due? (for a scheduled workflow)
ghdash-pages studio-assets       public/studio-data/ for the in-browser admin
ghdash-pages fetch-browser-api   public/studio-api/ from a pages-v* release (BROWSER_API_TAG, BROWSER_API_URL, BROWSER_API_DIR)
ghdash-pages copy-media          media/ -> public/media/
ghdash-pages finish [dist]       after `astro build`: base path, media URLs, redirect pages (BASE_PATH)
ghdash-pages export-content      data.db -> content/
ghdash-pages serve               serve dist/client under BASE_PATH, like Pages
```

A typical site build script:

```
ghdash-pages build-db && ghdash-pages studio-assets && ghdash-pages fetch-browser-api && ghdash-pages copy-media && astro build && ghdash-pages finish && pagefind --site dist/client
```

The in-browser studio (`src/studio/`) and the Pagefind search page are still part of the site template. See `GHDash-example` for a working site.
