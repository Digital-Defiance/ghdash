# Steps only the repository owner can do

Everything here needs an account, a setting or a secret that an agent should not have. Nothing secret is ever pasted into a chat or a commit. Written 2026-11-14 for `Digital-Defiance/ghdash` (the port) and `Digital-Defiance/GHDash-example` (the demo).

## 1. Release tags (every release)

Tag pushes from the cloud sandbox hang, so the owner pushes them from a Mac.

- Release files for sites: `git tag pages-v<next> <commit> && git push origin pages-v<next>` (builds the admin, core, browser API and adapter tarballs and creates the GitHub release).
- npm release of the adapter: `git tag adapter-v<version> <commit> && git push origin adapter-v<version>`. The tag must match `version` in `ghpages-port/adapter/package.json`. The workflow `publish-adapter.yml` publishes with npm trusted publishing (no token).

If the release job fails with `403 Resource not accessible by integration`, the Actions workflow permissions are locked (enterprise, then org, then repo: Settings, Actions, General, Workflow permissions, Read and write).

## 2. Sign in with GitHub for the demo (optional, about 15 minutes)

1. github.com, Settings, Developer settings, GitHub Apps, **New GitHub App**.
   - Name: anything, for example `GHDash example sign-in`.
   - Homepage URL: `https://digital-defiance.github.io/GHDash-example/`.
   - Callback URL: `https://digital-defiance.github.io/GHDash-example/studio/`.
   - Untick **Webhook**.
   - Repository permissions: **Contents: Read and write** (Metadata read is added automatically).
   - Where can this app be installed: only on this account.
2. On the app's page copy the **Client ID**. Click **Generate a new client secret** and keep the page open.
3. App page, **Install App**, install on `GHDash-example` only.
4. In a terminal in a checkout of `GHDash-example`, after `npm install`: `npx wrangler login` (once, opens Cloudflare in the browser), then
   `npx wrangler deploy node_modules/@digitaldefiance/ghdash-pages/worker/github-oauth.mjs --name ghdash-sign-in --var ALLOWED_ORIGIN:https://digital-defiance.github.io --var GITHUB_CLIENT_ID:<client id>`
5. `npx wrangler secret put GITHUB_CLIENT_SECRET --name ghdash-sign-in`, paste the secret at the prompt, press Enter.
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
