// Splits an older content/revisions.json into content/revisions/<id>.json, one file per row.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "content";
const file = join(dir, "revisions.json");
if (!existsSync(file)) {
	console.log("no revisions.json, nothing to do");
	process.exit(0);
}
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const rows = JSON.parse(readFileSync(file, "utf8"));
mkdirSync(join(dir, "revisions"), { recursive: true });
for (const r of rows) writeFileSync(join(dir, "revisions", `${r.id}.json`), JSON.stringify(sortKeys(r), null, "\t") + "\n");
rmSync(file);
console.log(`split ${rows.length} revisions into ${join(dir, "revisions")}/`);
