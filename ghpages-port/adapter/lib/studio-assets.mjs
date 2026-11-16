// Writes the data the in-browser admin loads: public/studio-data/{content.json,empty.db}, and the media service worker at public/studio/media-sw.js.
// Run after `ghdash-pages build-db`. content.json is the repo's content/ tree as one file.
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { repoMeta } from "./host.mjs";

const out = "public/studio-data";
mkdirSync(out, { recursive: true });
const dir = "content";
const ddl = JSON.parse(readFileSync(join(dir, "_ddl.json"), "utf8"));
const tables = {};
const names = readdirSync(dir).toSorted();
const isDir = (n) => statSync(join(dir, n)).isDirectory();
// Plain files first, so a per-row directory wins over an older single file for the same table.
for (const n of [...names.filter((x) => !isDir(x)), ...names.filter(isDir)]) {
	if (n === "_ddl.json") continue;
	const q = join(dir, n);
	const t = n.replace(/\.json$/, "");
	const rows = isDir(n)
		? readdirSync(q)
				.toSorted()
				.map((f) => JSON.parse(readFileSync(join(q, f), "utf8")))
		: JSON.parse(readFileSync(q, "utf8"));
	const byId = new Map((tables[t] ?? []).map((r) => [r.id, r]));
	tables[t] = byId.size ? [...new Map([...byId, ...rows.map((r) => [r.id, r])]).values()] : rows;
}
const meta = repoMeta();
if (!meta.repo)
	console.warn(
		"studio-assets: could not tell which repository to commit to; set STUDIO_REPO (and STUDIO_PROVIDER for GitLab)",
	);
mkdirSync("public/studio", { recursive: true });
copyFileSync(
	fileURLToPath(new URL("../studio/media-sw.js", import.meta.url)),
	"public/studio/media-sw.js",
);
writeFileSync(join(out, "content.json"), JSON.stringify({ ddl, tables, meta }));
execFileSync(
	process.execPath,
	[
		fileURLToPath(new URL("./make-empty-db.mjs", import.meta.url)),
		"data.db",
		dir,
		join(out, "empty.db"),
	],
	{ stdio: "inherit" },
);
