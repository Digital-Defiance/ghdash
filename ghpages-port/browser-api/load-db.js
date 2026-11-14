// freshBytes is optional: _ddl.json holds the whole schema, so an empty DB works too.
// Opens an in-memory SQLite (sqlite-wasm) from a migrated empty DB plus the repo's JSON tables,
// and returns a better-sqlite3-shaped adapter for Kysely's SqliteDialect.
export function openDb(sqlite, freshBytes, { ddl, tables }) {
	const db = new sqlite.oo1.DB();
	if (freshBytes) {
		const bytes = new Uint8Array(freshBytes);
		bytes[18] = 1;
		bytes[19] = 1;
		const p = sqlite.wasm.allocFromTypedArray(bytes);
		const rc = sqlite.capi.sqlite3_deserialize(db.pointer, "main", p, bytes.length, bytes.length,
			sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE);
		if (rc) throw new Error("sqlite3_deserialize failed: " + rc);
	}
	db.exec("PRAGMA foreign_keys=OFF; BEGIN");
	for (const o of ddl.filter((o) => o.type === "table")) db.exec(o.sql);
	for (const o of ddl.filter((o) => o.type === "trigger")) db.exec(o.sql);
	for (const [t, rows] of Object.entries(tables)) {
		for (const r of rows) {
			const c = Object.keys(r);
			db.exec({
				sql: `insert or replace into "${t}" (${c.map((x) => `"${x}"`)}) values (${c.map(() => "?")})`,
				bind: c.map((x) => r[x]),
			});
		}
	}
	for (const o of ddl.filter((o) => o.type === "index")) db.exec(o.sql);
	db.exec("COMMIT");
	const database = {
		close() { db.close(); },
		prepare(sql) {
			const reader = (() => { const s = db.prepare(sql); const n = s.columnCount; s.finalize(); return n > 0; })();
			return {
				reader,
				all(params) { const rows = []; db.exec({ sql, bind: params.length ? params : undefined, rowMode: "object", resultRows: rows }); return rows; },
				run(params) {
					db.exec({ sql, bind: params.length ? params : undefined });
					return { changes: sqlite.capi.sqlite3_changes(db.pointer), lastInsertRowid: BigInt(sqlite.capi.sqlite3_last_insert_rowid(db.pointer)) };
				},
				*iterate(params) { yield* this.all(params); },
			};
		},
	};
	return { db, database };
}
