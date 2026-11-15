import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("the empty database keeps the media usage activation row that creating a collection needs", () => {
	const dir = mkdtempSync(join(tmpdir(), "empty-"));
	const src = join(dir, "src.db");
	const db = new DatabaseSync(src);
	db.exec(`create table _emdash_media_usage_activation (task_key text primary key, state text not null default 'expanded');
		insert into _emdash_media_usage_activation (task_key, state) values ('incremental_capture', 'expanded');
		create table other (id text); insert into other values ('x');`);
	db.close();
	writeFileSync(join(dir, "_ddl.json"), "[]");
	const out = join(dir, "empty.db");
	const r = spawnSync(
		process.execPath,
		[new URL("./make-empty-db.mjs", import.meta.url).pathname, src, dir, out],
		{ encoding: "utf8" },
	);
	assert.equal(r.status, 0, r.stderr);
	const e = new DatabaseSync(out);
	assert.equal(e.prepare("select count(*) c from other").get().c, 0);
	assert.equal(
		e
			.prepare(
				"select count(*) c from _emdash_media_usage_activation where task_key='incremental_capture'",
			)
			.get().c,
		1,
	);
});
