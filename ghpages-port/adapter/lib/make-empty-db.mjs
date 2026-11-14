// node make-empty-db.mjs <populated.db> <content-dir> <out.db>
// Produces a migrated database with no rows and none of the objects that _ddl.json recreates.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const [src, dir, out] = process.argv.slice(2);
rmSync(out, { force: true });
copyFileSync(src, out);
const db = new DatabaseSync(out);
db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE");
const ddl = JSON.parse(readFileSync(join(dir, "_ddl.json"), "utf8"));
const order = { trigger: 0, index: 1, table: 2 };
for (const o of ddl.toSorted((a, b) => order[a.type] - order[b.type])) db.exec(`DROP ${o.type.toUpperCase()} IF EXISTS "${o.name}"`);
db.exec("PRAGMA foreign_keys=OFF");
const left = db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all();
for (const { name } of left) { try { db.exec(`DELETE FROM "${name}"`); } catch {} }
db.exec("VACUUM");
console.log("tables kept:", left.length);
db.close();
