// Writes the data the in-browser admin loads: public/studio-data/{content.json,empty.db}.
// Run after `ghdash-pages build-db`. content.json is the repo's content/ tree as one file.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = "public/studio-data";
mkdirSync(out, { recursive: true });
const dir = "content";
const ddl = JSON.parse(readFileSync(join(dir, "_ddl.json"), "utf8"));
const tables = {};
for (const n of readdirSync(dir).sort()) {
	if (n === "_ddl.json") continue;
	const q = join(dir, n);
	tables[n.replace(/\.json$/, "")] = statSync(q).isDirectory()
		? readdirSync(q).sort().map((f) => JSON.parse(readFileSync(join(q, f), "utf8")))
		: JSON.parse(readFileSync(q, "utf8"));
}
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim(); } catch { return ""; } };
const remote = sh("git", ["remote", "get-url", "origin"]).match(/github\.com[:/]([^/]+\/[^/.]+)/)?.[1];
const meta = {
	repo: process.env.GITHUB_REPOSITORY || remote || "",
	branch: process.env.STUDIO_BRANCH || process.env.GITHUB_REF_NAME || sh("git", ["branch", "--show-current"]) || "main",
	head: process.env.GITHUB_SHA || sh("git", ["rev-parse", "HEAD"]),
};
writeFileSync(join(out, "content.json"), JSON.stringify({ ddl, tables, meta }));
execFileSync(process.execPath, [fileURLToPath(new URL("./make-empty-db.mjs", import.meta.url)), "data.db", dir, join(out, "empty.db")], { stdio: "inherit" });
