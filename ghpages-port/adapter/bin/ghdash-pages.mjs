#!/usr/bin/env node
// Build-side commands for an EmDash site that runs on GitHub Pages. Run them from the site's root.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const lib = (name) => fileURLToPath(new URL(`../lib/${name}.mjs`, import.meta.url));
const run = (name, args = []) => {
	const r = spawnSync(process.execPath, [lib(name), ...args], { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
};

const [cmd, ...rest] = process.argv.slice(2);
const dist = rest[0] ?? "dist/client";

const commands = {
	"build-db": ["Build data.db from content/*.json", () => run("build-db", rest)],
	"export-content": ["Write content/ from a database: export-content [db] [dir]", () => run("db-json", ["export", rest[0] ?? "data.db", rest[1] ?? "content"])],
	"split-revisions": ["Split an older content/revisions.json into one file per revision [dir]", () => run("split-revisions", rest)],
	"publish-due": ["Publish scheduled entries that are due, and write content/ back", () => run("publish-due", rest)],
	due: ["Print true if a scheduled entry is due (reads content/ only)", () => run("due", rest)],
	"studio-assets": ["Write public/studio-data for the in-browser admin", () => run("studio-assets")],
	"fetch-browser-api": ["Put the in-browser API into public/studio-api", () => run("fetch-browser-api")],
	"copy-media": ["Copy media/ to public/media/", () => run("copy-media")],
	finish: ["Post-build: rebase URLs, media URLs and redirects in the built site [distDir]", () => { run("rebase-urls", [dist]); run("redirects", [dist]); }],
	serve: ["Serve the built site under BASE_PATH, like Pages", () => run("serve-dist")],
};

if (!cmd || !commands[cmd]) {
	console.error(`usage: ghdash-pages <command>\n\n${Object.entries(commands).map(([n, [d]]) => `  ${n.padEnd(18)}${d}`).join("\n")}`);
	process.exit(cmd ? 1 : 0);
}
commands[cmd][1]();
