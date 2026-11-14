# EmDash on GitHub Pages

Working notes for running EmDash as a static site on GitHub Pages, with content stored as JSON in a public repo and edits committed through the GitHub API.

- [SPEC.md](./SPEC.md): design, decisions (D1 to D14), results of each phase. Read first.
- [TODO.md](./TODO.md): phased checklist and current status.
- [spike/](./spike): Phase 0 code (JSON round trip, browser handlers on sqlite-wasm, PAT commit).
- Demo and test site: [GHDash-example](https://github.com/Digital-Defiance/GHDash-example), live at https://digital-defiance.github.io/GHDash-example/.
- Admin build tarballs: release `pages-v*` assets, built by `.github/workflows/pages-tarballs.yml`.

The fork's own changes live on branch `spike/ghpages-phase0`. The repo's root README is left untouched to ease merging upstream.
