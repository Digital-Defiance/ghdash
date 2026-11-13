// Runs the browser bundle of EmDash's handlers against the official SQLite WASM build,
// loading the database from the repo JSON tree. No Node SQLite, no Astro.
import init from "@sqlite.org/sqlite-wasm";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import * as H from "./handlers.js";

const sqlite = await init({ print: () => {}, printErr: () => {} });
const [freshDb, contentDir] = process.argv.slice(2);

// 1. Start from a migrated empty DB (would ship as a static asset, or run the migrator in-browser).
const bytes = new Uint8Array(readFileSync(freshDb));
bytes[18] = 1; bytes[19] = 1; // WAL -> rollback journal: deserialized DBs cannot use WAL
const p = sqlite.wasm.allocFromTypedArray(bytes);
const db = new sqlite.oo1.DB();
const rc = sqlite.capi.sqlite3_deserialize(db.pointer, "main", p, bytes.length, bytes.length,
	sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE);
if (rc) throw new Error("deserialize " + rc);

// 2. Load the repo JSON (same algorithm as db-json.mjs import).
const ddl = JSON.parse(readFileSync(join(contentDir, "_ddl.json"), "utf8"));
db.exec("PRAGMA foreign_keys=OFF; BEGIN");
for (const o of ddl.filter((o) => o.type === "table")) db.exec(o.sql);
for (const o of ddl.filter((o) => o.type === "trigger")) db.exec(o.sql);
const load = (t, rows) => { for (const r of rows) { const c = Object.keys(r);
	db.exec({ sql: `insert or replace into "${t}" (${c.map((x) => `"${x}"`)}) values (${c.map(() => "?")})`, bind: c.map((x) => r[x]) }); } };
for (const n of readdirSync(contentDir).sort()) {
	if (n === "_ddl.json") continue; const q = join(contentDir, n);
	if (statSync(q).isDirectory()) load(n, readdirSync(q).map((f) => JSON.parse(readFileSync(join(q, f), "utf8"))));
	else load(n.replace(/\.json$/, ""), JSON.parse(readFileSync(q, "utf8")));
}
for (const o of ddl.filter((o) => o.type === "index")) db.exec(o.sql);
db.exec("COMMIT");

// 3. Minimal better-sqlite3-shaped adapter so Kysely's stock SqliteDialect works.
const adapter = {
	close() { db.close(); },
	prepare(sql) {
		const st = () => db.prepare(sql);
		const reader = (() => { const s = st(); const n = s.columnCount; s.finalize(); return n > 0; })();
		return {
			reader,
			all(params) { const rows = []; db.exec({ sql, bind: params.length ? params : undefined, rowMode: "object", resultRows: rows }); return rows; },
			run(params) { db.exec({ sql, bind: params.length ? params : undefined });
				return { changes: sqlite.capi.sqlite3_changes(db.pointer), lastInsertRowid: BigInt(sqlite.capi.sqlite3_last_insert_rowid(db.pointer)) }; },
			*iterate(params) { yield* this.all(params); },
		};
	},
};
const k = new H.Kysely({ dialect: new H.SqliteDialect({ database: adapter }) });

const show = (label, r) => console.log(label, r.success ? "OK" : "FAIL " + JSON.stringify(r.error));
const list = await H.content.handleContentList(k, "posts", { limit: 50 });
show("list posts:", list); console.log("  items:", list.data?.items?.length);
const created = await H.content.handleContentCreate(k, "posts", {
	data: { title: "Hello from the browser", excerpt: "Created by the in-browser handlers", content: [] },
	slug: "hello-from-the-browser", status: "draft",
});
show("create post:", created);
const id = created.data?.item?.id;
show("publish:", await H.content.handleContentPublish(k, "posts", id));
show("update:", await H.content.handleContentUpdate(k, "posts", id, { data: { title: "Hello again" } }));
const set = await H.settings.handleSettingsUpdate(k, null, { title: "Spike Blog" });
if (set) show("settings:", set);
console.log("fts hit:", db.selectValue("select count(*) from _emdash_fts_posts where _emdash_fts_posts match 'browser'"));
console.log("row:", db.selectObject("select slug,status,title,published_at from ec_posts where id=?", [id]));
const tax = await H.taxonomies.handleTermList?.(k, "category");
if (tax) show("terms:", tax);
const menus = await H.menus.handleMenuList?.(k);
if (menus) show("menus:", menus);
console.log("title setting:", db.selectValue("select value from options where name='site:title'"));
show("create collection:", await H.schema.handleSchemaCollectionCreate(k, { slug: "projects", label: "Projects", labelSingular: "Project" }));
console.log("ec_projects exists:", db.selectValue("select count(*) from sqlite_master where name='ec_projects'"));
