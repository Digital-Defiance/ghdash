// node test.mjs <content-dir> <empty.db>
import init from "@sqlite.org/sqlite-wasm";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as A from "./api.js";
import { openDb } from "./load-db.js";

const [dir, freshDb] = process.argv.slice(2);
const sqlite = await init({ print() {}, printErr() {} });
const ddl = JSON.parse(readFileSync(join(dir, "_ddl.json"), "utf8"));
const tables = {};
for (const n of readdirSync(dir).sort()) {
	if (n === "_ddl.json") continue;
	const q = join(dir, n);
	tables[n.replace(/\.json$/, "")] = statSync(q).isDirectory()
		? readdirSync(q).map((f) => JSON.parse(readFileSync(join(q, f), "utf8")))
		: JSON.parse(readFileSync(q, "utf8"));
}
const { database } = openDb(sqlite, readFileSync(freshDb), { ddl, tables });
const db = new A.Kysely({ dialect: new A.SqliteDialect({ database }) });
const api = A.createBrowserApi({ db, apiBase: "/GHDash-example/_api", user: { id: "gh-1", email: "a@b.c", name: "Tester" } });
let bad = 0;
const check = (name, cond) => { console.log(cond ? "PASS" : "FAIL", name); if (!cond) bad++; };
const m = await (await api("https://x.test/GHDash-example/_api/manifest")).json();
check("manifest ok", m.success && Object.keys(m.data.collections).includes("posts"));
console.log("  collections:", Object.keys(m.data.collections), "taxonomies:", m.data.taxonomies.map((t) => t.name), "title:", m.data.siteTitle);
const me = await (await api("https://x.test/GHDash-example/_api/auth/me")).json();
check("auth/me admin", me.success && me.data.role === 50);
const nf = await api("https://x.test/GHDash-example/_api/nope");
check("unknown route 404 json", nf.status === 404 && (await nf.json()).error.code === "NOT_FOUND");
process.exit(bad ? 1 : 0);
