// Runs plugin after-hooks for content that changed between two commits. Used by `ghdash-pages run-hooks`.
import { execFileSync } from "node:child_process";

const STANDARD = new Set([
	"id", "slug", "status", "author_id", "primary_byline_id", "created_at", "updated_at", "published_at", "scheduled_at",
	"deleted_at", "version", "live_revision_id", "draft_revision_id", "locale", "translation_group",
]);

const camel = (s) => s.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** A content row as the plugin hooks see it (the shape of the API's content item). */
export function toContentItem(collection, row) {
	const data = {};
	for (const [k, v] of Object.entries(row)) if (!STANDARD.has(k)) data[k] = v;
	return {
		id: row.id,
		type: collection,
		slug: row.slug ?? null,
		status: row.status,
		locale: row.locale ?? null,
		data,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		publishedAt: row.published_at ?? null,
		scheduledAt: row.scheduled_at ?? null,
		authorId: row.author_id ?? null,
		translationGroup: row.translation_group ?? null,
		liveRevisionId: row.live_revision_id ?? null,
		draftRevisionId: row.draft_revision_id ?? null,
		version: row.version,
	};
}

const PATH = /^content\/ec_([^/]+)\/([^/]+)\.json$/;

/** Hook events for the content files that differ between two commits. `read(path, rev)` returns file text. */
export function eventsFromDiff(nameStatus, head, read) {
	const events = [];
	for (const line of nameStatus.split("\n")) {
		const [status, ...paths] = line.trim().split("\t");
		const path = paths.at(-1);
		const m = path && PATH.exec(path);
		if (!status || !m) continue;
		const [, collection, id] = m;
		if (status.startsWith("D")) {
			events.push({ hook: "content:afterDelete", event: { id, collection } });
			continue;
		}
		const row = JSON.parse(read(path, head));
		if (row.deleted_at) {
			events.push({ hook: "content:afterDelete", event: { id, collection } });
			continue;
		}
		events.push({ hook: "content:afterSave", event: { content: toContentItem(collection, row), collection, isNew: status.startsWith("A") } });
	}
	return events;
}

export function eventsBetween(base, head) {
	const out = git(["diff", "--name-status", "--no-renames", base, head, "--", "content"]);
	return eventsFromDiff(out, head, (path, rev) => git(["show", `${rev}:${path}`]));
}

function memoryStore() {
	const m = new Map();
	return {
		m,
		async get(k) { return m.has(k) ? m.get(k) : null; },
		async getVersioned(k) { return m.has(k) ? { value: m.get(k), revision: "0" } : null; },
		async set(k, v) { m.set(k, v); },
		async delete(k) { return m.delete(k); },
		async list(prefix = "") { return [...m].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })); },
	};
}

function memoryCollection() {
	const rows = new Map();
	return {
		async get(id) { return rows.get(id) ?? null; },
		async put(id, v) { rows.set(id, v); },
		async delete(id) { return rows.delete(id); },
		async deleteMany(ids) { for (const id of ids) rows.delete(id); return ids.length; },
		async count() { return rows.size; },
		async query({ limit = 50 } = {}) { return { items: [...rows].slice(0, limit).map(([id, data]) => ({ id, data })) }; },
	};
}

/**
 * The context a hook receives. State is kept in memory for the run: settings come from the site's config and the
 * environment, and nothing a plugin stores is kept afterwards. Content, media and schema access are not provided.
 */
export function makeContext(plugin, settings, { fetch = globalThis.fetch, site = {} } = {}) {
	const kv = memoryStore();
	const settingsStore = memoryStore();
	for (const [k, v] of Object.entries(settings)) {
		kv.m.set(`settings:${k}`, v);
		settingsStore.m.set(k, v);
	}
	const collections = new Map();
	const storage = new Proxy({}, { get: (_t, name) => (collections.has(name) ? collections.get(name) : collections.set(name, memoryCollection()).get(name)) });
	const tag = `[${plugin.id}]`;
	return {
		plugin: { id: plugin.id, version: plugin.version ?? "0.0.0" },
		kv,
		settings: settingsStore,
		storage,
		http: { fetch },
		log: {
			debug: (...a) => console.debug(tag, ...a),
			info: (...a) => console.log(tag, ...a),
			warn: (...a) => console.warn(tag, ...a),
			error: (...a) => console.error(tag, ...a),
		},
		site: { name: site.name ?? "", url: site.url ?? "", locale: "en" },
	};
}

/** Resolves `{ "env": "NAME" }` setting values from the environment. A missing variable leaves the setting unset. */
export function resolveSettings(raw = {}, env = process.env) {
	const out = {};
	for (const [k, v] of Object.entries(raw)) {
		if (v && typeof v === "object" && "env" in v) {
			const value = env[v.env];
			if (value !== undefined && value !== "") out[k] = value;
		} else out[k] = v;
	}
	return out;
}

/** Runs each plugin's matching hooks for each event. A failing hook is reported and does not stop the others. */
export async function runHooks({ plugins, events, env = process.env, fetch, site }) {
	const results = [];
	for (const { plugin, definition, settings } of plugins) {
		const ctx = makeContext(plugin, resolveSettings(settings, env), { fetch, site });
		for (const { hook, event } of events) {
			const entry = definition.hooks?.[hook];
			const handler = typeof entry === "function" ? entry : entry?.handler;
			if (!handler) continue;
			try {
				await handler(event, ctx);
				results.push({ plugin: plugin.id, hook, ok: true });
			} catch (e) {
				console.error(`[${plugin.id}] ${hook} failed: ${e instanceof Error ? e.message : e}`);
				results.push({ plugin: plugin.id, hook, ok: false });
			}
		}
	}
	return results;
}
