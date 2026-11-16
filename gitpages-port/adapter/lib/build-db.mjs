#!/usr/bin/env node
// Builds data.db from the JSON in content/: a freshly migrated EmDash database, then the rows.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dbJson = fileURLToPath(new URL("./db-json.mjs", import.meta.url));

const db = process.argv[2] ?? "data.db";
for (const f of [db, `${db}-wal`, `${db}-shm`]) rmSync(f, { force: true });
execFileSync("npx", ["emdash", "init", "--database", db], { stdio: "inherit" });
if (existsSync("content/_ddl.json")) {
	execFileSync(process.execPath, [dbJson, "import", "content", db], { stdio: "inherit" });
} else {
	console.warn("content/ is empty: building from the seed instead");
	execFileSync("npx", ["emdash", "seed", "seed/seed.json", "--database", db], { stdio: "inherit" });
}
