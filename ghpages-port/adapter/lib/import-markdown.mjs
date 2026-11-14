// ghdash-pages import-markdown <dir> [--root <siteRoot>] [--posts posts] [--pages pages] [--dry-run]
// Imports a Jekyll site or a folder of Markdown files into content/ using EmDash's own content handlers,
// so slugs, revisions, taxonomies and search behave as if the entries were created in the studio.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { planEntries, slugify } from "./markdown-import.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const dir = args.find(
	(a, i) =>
		!a.startsWith("--") &&
		!(i > 0 && args[i - 1].startsWith("--") && !["--dry-run"].includes(args[i - 1])),
);
if (!dir) {
	console.error(
		"usage: ghdash-pages import-markdown <dir> [--root <siteRoot>] [--posts posts] [--pages pages] [--dry-run]",
	);
	process.exit(1);
}
const source = resolve(dir);
const siteRoot = resolve(flag("root", source));
const postCollection = flag("posts", "posts");
const pageCollection = flag("pages", "pages");

const { entries, warnings } = planEntries(source, { siteRoot, postCollection, pageCollection });
const count = (c) => entries.filter((e) => e.collection === c).length;
console.log(
	`found ${entries.length} entries: ${count(postCollection)} ${postCollection}, ${count(pageCollection)} ${pageCollection}, ${entries.reduce((n, e) => n + e.images.length, 0)} image reference(s)`,
);
if (args.includes("--dry-run")) {
	for (const e of entries)
		console.log(
			`  ${e.collection}/${e.slug}  ${e.status}  ${e.publishedAt?.slice(0, 10) ?? "no date"}  ${e.file}`,
		);
	for (const w of warnings) console.warn("WARNING:", w);
	process.exit(0);
}

const bin = fileURLToPath(new URL("../bin/ghdash-pages.mjs", import.meta.url));
const step = (cmd) => {
	const r = spawnSync(process.execPath, [bin, cmd], { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!existsSync("content/_ddl.json")) {
	console.error("content/_ddl.json not found: run this from the root of a GHDash site");
	process.exit(1);
}
step("build-db");
step("fetch-browser-api");
step("studio-assets");

const require = createRequire(join(process.cwd(), "package.json"));
const sqlite3InitModule = (
	await import(pathToFileURL(require.resolve("@sqlite.org/sqlite-wasm")).href)
).default;
const api = await import(pathToFileURL(resolve("public/studio-api/entry.js")).href);
if (!api.markdownToPortableText) {
	console.error(
		"The browser API in public/studio-api is too old for import-markdown; use release pages-v0.16.0 or later.",
	);
	process.exit(1);
}
const studio = (f) => import(new URL(`../studio/${f}`, import.meta.url).href);
const { openDb } = await studio("load-db.js");
const { snapshot, filesFromContent, diffFiles } = await studio("tray.js");

const sqlite = await sqlite3InitModule({ print() {}, printErr() {} });
const content = JSON.parse(readFileSync("public/studio-data/content.json", "utf8"));
const {
	db: raw,
	database,
	freshNames,
} = openDb(sqlite, readFileSync("public/studio-data/empty.db"), content);
const baseFiles = filesFromContent(content);
const db = new api.Kysely({ dialect: new api.SqliteDialect({ database }) });
const fetchApi = api.createBrowserApi({
	db,
	apiBase: "/_api",
	user: { id: "importer", email: "importer@users.noreply.github.com", name: "Importer" },
});
const call = async (method, path, body) => {
	const res = await fetchApi(`https://import.local/_api${path}`, {
		method,
		headers: { "content-type": "application/json", "x-emdash-request": "1" },
		body: body && JSON.stringify(body),
	});
	return { status: res.status, json: await res.json() };
};

const hasField = (collection, field) =>
	raw.selectValue(
		"select count(*) from _emdash_fields f join _emdash_collections c on c.id = f.collection_id where c.slug = ? and f.slug = ?",
		[collection, field],
	) > 0;
const exists = (collection, slug) => {
	try {
		return (
			raw.selectValue(
				`select count(*) from "ec_${collection}" where slug = ? and deleted_at is null`,
				[slug],
			) > 0
		);
	} catch {
		return false;
	}
};
const ensureTerm = async (taxonomy, name) => {
	const slug = slugify(name);
	const have = raw.selectValue("select count(*) from taxonomies where name = ? and slug = ?", [
		taxonomy,
		slug,
	]);
	if (!have) {
		const r = await call("POST", `/taxonomies/${taxonomy}/terms`, { slug, label: name });
		if (!r.json.success)
			throw new Error(`could not create ${taxonomy} "${name}": ${r.json.error?.message}`);
	}
	return slug;
};

mkdirSync("media", { recursive: true });
const copied = new Map();
const mediaKey = (file) => {
	if (copied.has(file)) return copied.get(file);
	const hash = createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 8);
	const key = `${hash}-${slugify(basename(file).replace(/\.[^.]+$/, "")) || "image"}${(/\.[^.]+$/.exec(file) ?? [""])[0].toLowerCase()}`;
	copyFileSync(file, join("media", key));
	copied.set(file, key);
	return key;
};

const skipped = [];
let created = 0;
for (const e of entries) {
	if (exists(e.collection, e.slug)) {
		skipped.push(`${e.collection}/${e.slug}`);
		continue;
	}
	const body = e.body.replace(
		/\u0000IMG(\d+)\u0000/g,
		(_m, i) => `/_emdash/api/media/file/${mediaKey(e.images[Number(i)])}`,
	);
	const data = { title: e.title, content: api.markdownToPortableText(body) };
	if (e.excerpt && hasField(e.collection, "excerpt")) data.excerpt = e.excerpt;
	const taxonomies = {};
	try {
		if (e.tags.length) taxonomies.tag = await Promise.all(e.tags.map((t) => ensureTerm("tag", t)));
		if (e.categories.length)
			taxonomies.category = await Promise.all(e.categories.map((t) => ensureTerm("category", t)));
	} catch (err) {
		warnings.push(`${e.file}: ${err.message}`);
		delete taxonomies.tag;
		delete taxonomies.category;
	}
	const made = await call("POST", `/content/${e.collection}`, {
		data,
		slug: e.slug,
		status: "draft",
		...(e.publishedAt ? { publishedAt: e.publishedAt, createdAt: e.publishedAt } : {}),
		...(Object.keys(taxonomies).length ? { taxonomies } : {}),
	});
	if (!made.json.success) {
		warnings.push(`${e.file}: ${made.json.error?.message ?? "could not create"}`);
		continue;
	}
	if (e.status === "published") {
		const id = made.json.data.item.id;
		const pub = await call("POST", `/content/${e.collection}/${id}/publish`, {});
		if (!pub.json.success)
			warnings.push(`${e.file}: created as a draft, could not publish: ${pub.json.error?.message}`);
	}
	created++;
}

let written = 0;
for (const change of diffFiles(baseFiles, snapshot(raw, freshNames))) {
	const text = snapshot(raw, freshNames).get(change.path);
	if (text === undefined) continue;
	mkdirSync(dirname(join("content", change.path)), { recursive: true });
	writeFileSync(join("content", change.path), text);
	written++;
}
console.log(
	`imported ${created} entries, skipped ${skipped.length} that already exist, copied ${copied.size} image(s), wrote ${written} file(s) in content/`,
);
for (const s of skipped) console.log(`  skipped ${s}`);
for (const w of warnings) console.warn("WARNING:", w);
