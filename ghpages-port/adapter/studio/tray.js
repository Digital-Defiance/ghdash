// Pending-changes logic: turns the in-browser database into the repo's JSON files, diffs them against
// the files it was loaded from, and applies files back to the database (discard, merge).
// The file layout and skip rules mirror ghdash-pages lib/db-json.mjs, which writes content/ at build time.

const SKIP = [
	/^_emdash_fts_/,
	/^_emdash_migrations/,
	/_locks?$/,
	/^_emdash_media_usage_/,
	/^_emdash_redirect_state$/,
	/^_emdash_rate_limits$/,
	/^_emdash_404_log$/,
	/^sqlite_/,
	/^users$/, /^sessions$/, /^credentials$/, /^auth_/, /^_emdash_api_tokens$/, /^_emdash_oauth/,
	/^_emdash_authorization_codes$/, /^allowed_domains$/, /^_emdash_rooms?/, /^_emdash_room_/,
];
const skip = (t) => SKIP.some((r) => r.test(t));
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const perRow = (t) => t.startsWith("ec_") || t === "revisions";
export const stringify = (v) => JSON.stringify(v, null, "\t") + "\n";
export const canonical = (text) => stringify(JSON.parse(text));

const q = (name) => `"${name.replace(/"/g, '""')}"`;
const FTS_SHADOW = /^_emdash_fts_.*_(data|idx|content|docsize|config)$/;

function pkCols(db, t) {
	const cols = db.selectObjects(`PRAGMA table_info(${q(t)})`);
	const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
	return pk.length ? pk : cols.map((c) => c.name);
}

/** Map of repo path (relative to content/) -> file text, for the database as it is now. */
export function snapshot(db, freshNames) {
	const files = new Map();
	const ddl = db
		.selectObjects("select type,name,sql from sqlite_master where sql is not null order by rowid")
		.filter((o) => !freshNames.has(o.name) && !FTS_SHADOW.test(o.name))
		.map((o) => ({ type: o.type, name: o.name, sql: o.sql }))
		.sort((x, y) => x.type.localeCompare(y.type) || x.name.localeCompare(y.name));
	files.set("_ddl.json", stringify(ddl));
	const tables = db.selectValues("select name from sqlite_master where type='table' order by name").filter((t) => !skip(t));
	for (const t of tables) {
		const pk = pkCols(db, t);
		const rows = db.selectObjects(`select * from ${q(t)} order by ${pk.map(q).join(",")}`).map((r) => sortKeys(r));
		if (!rows.length) continue;
		if (perRow(t)) for (const r of rows) files.set(`${t}/${r.id}.json`, stringify(r));
		else files.set(`${t}.json`, stringify(rows));
	}
	return files;
}

/** Expands an older single revisions.json into per-row files; rows already present as files win. */
export function expandLegacyRevisions(files) {
	const legacy = files.get("revisions.json");
	if (legacy === undefined) return files;
	files.delete("revisions.json");
	for (const r of JSON.parse(legacy)) {
		const path = `revisions/${r.id}.json`;
		if (!files.has(path)) files.set(path, stringify(sortKeys(r)));
	}
	return files;
}

/** The same Map, built from the repo's JSON as loaded (used when the database isn't the source). */
export function filesFromContent({ ddl, tables }) {
	const files = new Map([["_ddl.json", stringify(ddl)]]);
	for (const [t, rows] of Object.entries(tables)) {
		if (perRow(t)) for (const r of rows) files.set(`${t}/${r.id}.json`, stringify(sortKeys(r)));
		else files.set(`${t}.json`, stringify(rows.map(sortKeys)));
	}
	return files;
}

const TABLE_LABELS = {
	options: "Settings",
	_emdash_menus: "Menus",
	_emdash_menu_items: "Menus",
	_emdash_taxonomy_defs: "Taxonomies",
	taxonomies: "Terms",
	content_taxonomies: "Post terms",
	_emdash_bylines: "Bylines",
	_emdash_content_bylines: "Bylines",
	_emdash_collections: "Content types",
	_emdash_fields: "Content types",
	_emdash_sections: "Sections",
	_emdash_widgets: "Widgets",
	_emdash_widget_areas: "Widgets",
	_emdash_redirects: "Redirects",
	_emdash_comments: "Comments",
	media: "Media",
};

function describe(path, base, cur) {
	const kind = base === undefined ? "added" : cur === undefined ? "deleted" : "modified";
	if (path === "_ddl.json") return { path, kind, group: "Schema", label: "Database schema", discardable: false };
	const m = path.match(/^(ec_[^/]+|revisions)\/(.+)\.json$/);
	if (m && m[1] === "revisions") {
		const row = JSON.parse(cur ?? base);
		let title = m[2];
		try { title = JSON.parse(row.data).title || title; } catch {}
		return { path, kind, group: "Site", label: `Revisions: ${title}`, discardable: true };
	}
	if (m) {
		const row = JSON.parse(cur ?? base);
		const collection = m[1].slice(3);
		return { path, kind, group: collection, label: row.title || row.slug || m[2], discardable: true };
	}
	const table = path.replace(/\.json$/, "");
	return { path, kind, group: "Site", label: TABLE_LABELS[table] ?? table, discardable: true };
}

export function diffFiles(base, cur) {
	const out = [];
	for (const [path, text] of cur) if (base.get(path) !== text) out.push(describe(path, base.get(path), text));
	for (const [path, text] of base) if (!cur.has(path)) out.push(describe(path, text, undefined));
	return out.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}

/** Like diffFiles, but a revision row that belongs to a changed entry is folded into that entry's change. */
export function visibleChanges(base, cur) {
	const all = diffFiles(base, cur);
	const owned = new Set();
	for (const c of all) {
		const m = c.path.match(/^ec_[^/]+\/(.+)\.json$/);
		if (m) owned.add(m[1]);
	}
	return all.filter((c) => {
		if (!c.path.startsWith("revisions/")) return true;
		const row = JSON.parse(cur.get(c.path) ?? base.get(c.path));
		return !owned.has(row.entry_id);
	});
}

/** Paths of revision rows that belong to the content entry at `path`. */
export function revisionPathsFor(base, cur, path) {
	const m = path.match(/^ec_[^/]+\/(.+)\.json$/);
	if (!m) return [];
	return diffFiles(base, cur)
		.map((c) => c.path)
		.filter((p) => p.startsWith("revisions/") && JSON.parse(cur.get(p) ?? base.get(p)).entry_id === m[1]);
}

function insertRow(db, t, row) {
	const c = Object.keys(row);
	db.exec({
		sql: `insert or replace into ${q(t)} (${c.map(q).join(",")}) values (${c.map(() => "?").join(",")})`,
		bind: c.map((k) => (typeof row[k] === "boolean" ? Number(row[k]) : row[k])),
	});
}

/** Makes the database match one file: text puts its rows in, null removes them. `_ddl.json` is not applied. */
export function applyFile(db, path, text) {
	if (path === "_ddl.json") return;
	db.exec("PRAGMA foreign_keys=OFF");
	const m = path.match(/^(ec_[^/]+|revisions)\/(.+)\.json$/);
	if (m) {
		db.exec({ sql: `delete from ${q(m[1])} where id = ?`, bind: [m[2]] });
		if (text !== null) insertRow(db, m[1], JSON.parse(text));
		return;
	}
	const t = path.replace(/\.json$/, "");
	db.exec(`delete from ${q(t)}`);
	if (text !== null) for (const r of JSON.parse(text)) insertRow(db, t, r);
}

/** Folds a newer remote copy into the database. Local edits to files the remote also changed are kept and reported. */
export function mergeRemote(db, oldBase, remote, local) {
	const clashes = [];
	for (const path of new Set([...oldBase.keys(), ...remote.keys()])) {
		const b = oldBase.get(path), r = remote.get(path), l = local.get(path);
		if (r === b) continue;
		if (l === b) applyFile(db, path, r ?? null);
		else if (l !== r) clashes.push(path);
	}
	return clashes;
}
