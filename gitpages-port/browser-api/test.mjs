import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// node test.mjs <content-dir> <empty.db>
import init from "@sqlite.org/sqlite-wasm";

import * as A from "./dist/entry.js";
import { openDb } from "./load-db.js";

const [dir, freshDb] = process.argv.slice(2);
const sqlite = await init({ print() {}, printErr() {} });
const ddl = JSON.parse(readFileSync(join(dir, "_ddl.json"), "utf8"));
const tables = {};
for (const n of readdirSync(dir).toSorted()) {
	if (n === "_ddl.json") continue;
	const q = join(dir, n);
	tables[n.replace(/\.json$/, "")] = statSync(q).isDirectory()
		? readdirSync(q).map((f) => JSON.parse(readFileSync(join(q, f), "utf8")))
		: JSON.parse(readFileSync(q, "utf8"));
}
const { database } = openDb(sqlite, readFileSync(freshDb), { ddl, tables });
const db = new A.Kysely({ dialect: new A.SqliteDialect({ database }) });
const api = A.createBrowserApi({
	db,
	apiBase: "/GitDash-example/_api",
	user: { id: "gh-1", email: "a@b.c", name: "Tester" },
});
let bad = 0;
const check = (name, cond) => {
	console.log(cond ? "PASS" : "FAIL", name);
	if (!cond) bad++;
};
const m = await (await api("https://x.test/GitDash-example/_api/manifest")).json();
check("manifest ok", m.success && Object.keys(m.data.collections).includes("posts"));
console.log(
	"  collections:",
	Object.keys(m.data.collections),
	"taxonomies:",
	m.data.taxonomies.map((t) => t.name),
	"title:",
	m.data.siteTitle,
);
const me = await (await api("https://x.test/GitDash-example/_api/auth/me")).json();
check("auth/me admin", me.success && me.data.role === 50);
const nf = await api("https://x.test/GitDash-example/_api/nope");
check("unknown route 404 json", nf.status === 404 && (await nf.json()).error.code === "NOT_FOUND");
const B = "https://x.test/GitDash-example/_api";
const call = async (method, path, body) => {
	const r = await api(B + path, {
		method,
		headers: { "content-type": "application/json" },
		body: body && JSON.stringify(body),
	});
	return { status: r.status, json: await r.json() };
};
const dash = await call("GET", "/dashboard");
check("dashboard", dash.json.success);
const list = await call("GET", "/content/posts?limit=50");
check("list posts", list.json.success && list.json.data.items.length > 0);
const created = await call("POST", "/content/posts", {
	data: { title: "From the router", excerpt: "x", content: [] },
	slug: "from-the-router",
});
check("create post 201", created.status === 201 && created.json.success);
const id = created.json.data.item.id;
check("get post", (await call("GET", "/content/posts/" + id)).json.success);
check(
	"update post",
	(await call("PUT", "/content/posts/" + id, { data: { title: "Renamed" } })).json.success,
);
const pub = await call("POST", `/content/posts/${id}/publish`, {});
check("publish post", pub.json.success && pub.json.data.item.status === "published");
const got = await call("GET", "/content/posts/" + id);
check("title persisted", got.json.data.item.data.title === "Renamed");
check("delete post", (await call("DELETE", "/content/posts/" + id)).json.success);
check("missing post 404", (await call("GET", "/content/posts/" + id + "zz")).status === 404);
check("taxonomies", (await call("GET", "/taxonomies")).json.success);
check("bylines", (await call("GET", "/admin/bylines?limit=100")).json.success);
check("users", (await call("GET", "/admin/users?limit=100")).json.data.items.length === 1);
const first = list.json.data.items[0].id;
const lk = await call("POST", `/content/posts/${first}/lock`, {});
check("lock acquire", lk.json.success);
console.log("  lock:", JSON.stringify(lk.json.data));
const guarded = A.createBrowserApi({
	db,
	apiBase: "/GitDash-example/_api",
	user: { id: "gh-1", email: "a@b.c", name: "Tester" },
	plugins: [
		{
			id: "guard",
			beforeSave: ({ data, isNew }) => {
				if (String(data.title).includes("forbidden"))
					throw A.saveRejected("That title is not allowed");
				if (isNew) return { ...data, title: String(data.title).toUpperCase() };
			},
		},
	],
});
const gcall = async (method, path, body) => {
	const r = await guarded(B + path, {
		method,
		headers: { "content-type": "application/json" },
		body: body && JSON.stringify(body),
	});
	return { status: r.status, json: await r.json() };
};
const g1 = await gcall("POST", "/content/posts", {
	data: { title: "quiet", excerpt: "x", content: [] },
	slug: "quiet",
});
check(
	"beforeSave rewrites a new entry",
	g1.status === 201 && g1.json.data.item.data.title === "QUIET",
);
const g2 = await gcall("POST", "/content/posts", {
	data: { title: "forbidden one", excerpt: "x", content: [] },
	slug: "nope",
});
check(
	"beforeSave refuses a create",
	!g2.json.success &&
		g2.json.error.code === "SAVE_REJECTED" &&
		g2.json.error.message === "That title is not allowed",
);
check(
	"a refused create saved nothing",
	(await gcall("GET", "/content/posts?limit=100")).json.data.items.every((i) => i.slug !== "nope"),
);
const g3 = await gcall("PUT", "/content/posts/" + g1.json.data.item.id, {
	data: { title: "forbidden again" },
});
check("beforeSave refuses an update", !g3.json.success && g3.json.error.code === "SAVE_REJECTED");
check(
	"a refused update kept the old title",
	(await gcall("GET", "/content/posts/" + g1.json.data.item.id)).json.data.item.data.title ===
		"QUIET",
);
process.exit(bad ? 1 : 0);
