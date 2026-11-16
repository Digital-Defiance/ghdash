# Steps only the repository owner can do

Everything here needs an account, a setting or a secret that an agent should not have. Nothing secret is ever pasted into a chat or a commit. Written 2026-11-14 for `Digital-Defiance/gitdash` (the port) and `Digital-Defiance/GitDash-example` (the demo).

## 1. Release tags (every release)

Tag pushes from the cloud sandbox hang, so the owner pushes them from a Mac.

- Release files for sites: `git tag pages-v<next> <commit> && git push origin pages-v<next>` (builds the admin, core, browser API and adapter tarballs and creates the GitHub release).
- npm release of the adapter: `git tag adapter-v<version> <commit> && git push origin adapter-v<version>`. The tag must match `version` in `gitpages-port/adapter/package.json`. The workflow `publish-adapter.yml` publishes with npm trusted publishing (no token).

If the release job fails with `403 Resource not accessible by integration`, the Actions workflow permissions are locked (enterprise, then org, then repo: Settings, Actions, General, Workflow permissions, Read and write).

## 2. Sign in with GitHub for the demo (optional, about 15 minutes)

1. github.com, Settings, Developer settings, GitHub Apps, **New GitHub App**.
   - Name: anything, for example `GitDash example sign-in`.
   - Homepage URL: `https://digital-defiance.github.io/GitDash-example/`.
   - Callback URL: `https://digital-defiance.github.io/GitDash-example/studio/`.
   - Untick **Webhook**.
   - Repository permissions: **Contents: Read and write** (Metadata read is added automatically).
   - Where can this app be installed: only on this account.
2. On the app's page copy the **Client ID**. Click **Generate a new client secret** and keep the page open.
3. App page, **Install App**, install on `GitDash-example` only.
4. In a terminal in a checkout of `GitDash-example`, after `npm install`: `npx wrangler login` (once, opens Cloudflare in the browser), then
   `npx wrangler deploy node_modules/@digitaldefiance/gitdash-pages/worker/github-oauth.mjs --name gitdash-sign-in --var ALLOWED_ORIGIN:https://digital-defiance.github.io --var GITHUB_CLIENT_ID:<client id>`
5. `npx wrangler secret put GITHUB_CLIENT_SECRET --name gitdash-sign-in`, paste the secret at the prompt, press Enter.
6. Copy the Worker address wrangler prints (ends in `.workers.dev`), copy `github-oauth.example.json` to `github-oauth.json` in the demo, fill in the client ID and that address, commit. The button appears after the next build.

Tokens last 8 hours, then the editor signs in again. To undo: delete `github-oauth.json`.

## 3. Contact form (pick one, per site)

In `contact.json` (copy `contact.example.json`):

- **Stay on GitHub:** `{ "issueRepo": "owner/repo" }`. Messages become public issues labelled `contact`.
- **Form service:** create a form at Formspree, Web3Forms or similar, put its HTTPS address in `endpoint`.
- **Own Worker:** `worker/contact-worker.mjs` in the demo; needs a Cloudflare account and a Resend account and domain (SETUP.md section 9).

## 4. Comments (giscus)

Enable Discussions on the site repository, install the giscus app, get the repo and category IDs from giscus.app, copy `giscus.example.json` to `giscus.json`, commit.

## 5. Webhooks on content change (optional)

Add the plugin's URL as an Actions secret (for the demo, `WEBHOOK_URL`; Jessica has none, so skipped). See SETUP.md section 6.

## 6. Decisions still open for the owner

- ~~Merge the port into the fork's `main` branch~~ Done 2026-11-14 (fast-forward to `894f424`). The old `spike/ghpages-phase0` branch is kept for now.
- Upstream the browser API and the admin hooks to EmDash, or keep carrying the patched admin and core as release assets.

## Other hosts (optional, 2026-11-16)

- **Release:** after PR #4 merges, push `adapter-v0.14.0` (npm) from the Mac, as in section 1. The demo branch `hosts-gitlab-netlify` then moves to `^0.14.0`.
- **GitLab Pages:** a GitLab project with this site pushed to it; a personal access token (scope `api`) to try the studio. For scheduled posts and hooks: a project access token (Maintainer, `write_repository`) as masked CI/CD variable `GITDASH_PUSH_TOKEN`, and an hourly pipeline schedule. See the demo's SETUP.md, "Hosting on GitLab Pages".
- **Netlify:** import the repository in Netlify (the `netlify.toml` covers the settings), then set the repository variable `GITDASH_HOST=netlify` if GitHub Pages should stop deploying.
- **Cloudflare Pages:** `npx gitdash-pages add-host cloudflare`, set `name`, connect the repository in the dashboard with the build settings in the file, set `SITE_URL`, and `GITDASH_HOST=cloudflare-pages` on the repository.
