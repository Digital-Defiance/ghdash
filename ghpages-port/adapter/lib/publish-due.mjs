#!/usr/bin/env node
// Publishes entries whose scheduled time has passed, using EmDash's own publish logic from the browser API bundle,
// then writes the result back to content/ so the repository shows what the site shows.
// Run after `ghdash-pages build-db` and `fetch-browser-api`. Usage: publish-due [db] [contentDir]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dbPath = process.argv[2] ?? "data.db";
const contentDir = process.argv[3] ?? "content";
const bundle = resolve(process.env.BROWSER_API_DIR ?? "public/studio-api", "entry.js");
if (!existsSync(bundle)) throw new Error(`${bundle} not found: run fetch-browser-api first`);

const { Kysely, SqliteDialect, publishDue } = await import(pathToFileURL(bundle).href);
if (!publishDue) throw new Error("this browser API build can't publish scheduled content: use release pages-v0.6.0 or newer");

/** node:sqlite in the shape Kysely's SqliteDialect expects from better-sqlite3. */
function adapt(db) {
	return {
		close() { db.close(); },
		prepare(sql) {
			const stmt = db.prepare(sql);
			const reader = stmt.columns().length > 0;
			return {
				reader,
				all: (params) => stmt.all(...params),
				run: (params) => { const r = stmt.run(...params); return { changes: Number(r.changes), lastInsertRowid: BigInt(r.lastInsertRowid) }; },
				*iterate(params) { yield* stmt.all(...params); },
			};
		},
	};
}

const raw = new DatabaseSync(dbPath);
const db = new Kysely({ dialect: new SqliteDialect({ database: adapt(raw) }) });
const published = await publishDue(db);
await db.destroy();
if (published.length === 0) {
	console.log("no scheduled content is due");
} else {
	console.log(`published ${published.length}: ${published.map((p) => `${p.collection}/${p.id}`).join(", ")}`);
	execFileSync(process.execPath, [fileURLToPath(new URL("./db-json.mjs", import.meta.url)), "export", dbPath, contentDir], { stdio: "inherit" });
}
