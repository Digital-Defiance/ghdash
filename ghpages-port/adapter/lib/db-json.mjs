#!/usr/bin/env node
// Spike: lossless SQLite <-> JSON-tree round trip for an EmDash database.
//
//   node db-json.mjs export <db> <outDir>
//   node db-json.mjs import <outDir> <db>   (db must be freshly `emdash init`ed)
//
// Layout written to <outDir>:
//   _ddl.json                 CREATE statements for objects that migrations don't create
//                             (ec_* tables, their indexes, FTS tables and triggers)
//   <table>.json              rows of a small system table, sorted by primary key
//   <ec_table>/<id>.json      one file per content row, so diffs and merges stay per entry
//   revisions/<id>.json       one file per revision row (an older revisions.json is still read)
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Tables that are rebuilt, transient, or must never be published.
const SKIP = [
	/^_emdash_fts_/, // FTS shadow data, rebuilt on import
	/^_emdash_migrations/,
	/_locks?$/,
	/^_emdash_media_usage_/,
	/^_emdash_redirect_state$/,
	/^_emdash_rate_limits$/,
	/^_emdash_404_log$/,
	/^sqlite_/,
	// auth and secrets: GitHub permissions replace these
	/^users$/, /^sessions$/, /^credentials$/, /^auth_/, /^_emdash_api_tokens$/, /^_emdash_oauth/,
	/^_emdash_authorization_codes$/, /^allowed_domains$/, /^_emdash_rooms?/, /^_emdash_room_/,
];
const perRow = (t) => t.startsWith("ec_") || t === "revisions";
const skip = (t) => SKIP.some((r) => r.test(t));
const sortKeys = (o) =>
	Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const write = (p, v) => writeFileSync(p, JSON.stringify(v, null, "\t") + "\n");

function pkCols(db, t) {
	const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
	const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
	return pk.length ? pk : cols.map((c) => c.name);
}

function exportDb(dbPath, out, freshPath) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	const fresh = new DatabaseSync(freshPath, { readOnly: true });
	const baseline = new Set(fresh.prepare("select name from sqlite_master").all().map((r) => r.name));
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });

	const ddl = db
		.prepare("select type,name,tbl_name,sql from sqlite_master where sql is not null order by rowid")
		.all()
		.filter((o) => !baseline.has(o.name) && !/^_emdash_fts_.*_(data|idx|content|docsize|config)$/.test(o.name))
		.map((o) => ({ type: o.type, name: o.name, sql: o.sql }))
		.sort((x, y) => x.type.localeCompare(y.type) || x.name.localeCompare(y.name));
	write(join(out, "_ddl.json"), ddl);

	const tables = db
		.prepare("select name from sqlite_master where type='table' order by name")
		.all()
		.map((r) => r.name)
		.filter((t) => !skip(t));
	for (const t of tables) {
		const pk = pkCols(db, t);
		const rows = db
			.prepare(`select * from "${t}" order by ${pk.map((c) => `"${c}"`).join(",")}`)
			.all()
			.map((r) => sortKeys({ ...r }));
		if (!rows.length) continue;
		if (perRow(t)) {
			mkdirSync(join(out, t), { recursive: true });
			for (const r of rows) write(join(out, t, `${r.id}.json`), r);
		} else {
			write(join(out, `${t}.json`), rows);
		}
	}
	console.log(`exported ${tables.length} tables, ${ddl.length} DDL objects -> ${out}`);
}

function importDb(dir, dbPath) {
	const db = new DatabaseSync(dbPath);
	db.exec("PRAGMA foreign_keys=OFF; BEGIN");
	const ddl = JSON.parse(readFileSync(join(dir, "_ddl.json"), "utf8"));
	// Tables, then triggers (so FTS triggers index rows as they load), then rows, then indexes.
	for (const o of ddl.filter((o) => o.type === "table")) db.exec(o.sql);
	for (const o of ddl.filter((o) => o.type === "trigger")) db.exec(o.sql);
	const load = (t, rows) => {
		for (const r of rows) {
			const cols = Object.keys(r);
			db.prepare(
				`insert or replace into "${t}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`,
			).run(...cols.map((c) => r[c]));
		}
	};
	const names = readdirSync(dir).sort();
	const isDir = (n) => statSync(join(dir, n)).isDirectory();
	for (const name of [...names.filter((n) => !isDir(n)), ...names.filter(isDir)]) {
		if (name === "_ddl.json") continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			load(name, readdirSync(p).sort().map((f) => JSON.parse(readFileSync(join(p, f), "utf8"))));
		} else {
			load(name.replace(/\.json$/, ""), JSON.parse(readFileSync(p, "utf8")));
		}
	}
	for (const o of ddl.filter((o) => o.type === "index")) db.exec(o.sql);
	db.exec("COMMIT");
	console.log(`imported ${dir} -> ${dbPath}`);
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === "export") {
	let fresh = c;
	if (!fresh) {
		// The baseline is a freshly migrated DB: whatever it already contains is not exported as DDL.
		fresh = join(tmpdir(), `emdash-fresh-${process.pid}.db`);
		execFileSync("npx", ["emdash", "init", "--database", fresh], { stdio: "ignore" });
	}
	exportDb(a, b, fresh);
}
else if (cmd === "import") importDb(a, b);
else {
	console.error("usage: export <db> <outDir> [freshDb] | import <dir> <db>");
	process.exit(1);
}
