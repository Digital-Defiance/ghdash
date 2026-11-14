import type { Kysely } from "kysely";

import * as comments from "../../packages/core/src/api/handlers/comments.js";
import * as content from "../../packages/core/src/api/handlers/content.js";
import * as media from "../../packages/core/src/api/handlers/media.js";
import * as revision from "../../packages/core/src/api/handlers/revision.js";
import { buildManifestCollections } from "../../packages/core/src/api/handlers/manifest.js";
import { OptionsRepository } from "../../packages/core/src/database/repositories/options.js";
import { selectTaxonomyDefs } from "../../packages/core/src/database/repositories/taxonomy-def.js";
import { routeModules } from "./routes.generated.js";

const ADMIN_ROLE = 50;

export interface BrowserUser {
	id: string;
	email: string;
	name?: string;
	avatarUrl?: string;
}

export interface BeforeSaveEvent {
	data: Record<string, unknown>;
	collection: string;
	isNew: boolean;
	/** Present when an existing entry is being saved. */
	id?: string;
}

/** Throw this from `beforeSave` to refuse a save; the message is shown to the editor. */
export const saveRejected = (message: string) => Object.assign(new Error(message), { name: "SaveRejected" });

/** The parts of a plugin definition the admin manifest needs. Its server code does not run here. */
export interface BrowserPlugin {
	id: string;
	version?: string;
	/**
	 * Opt-in browser version of `content:beforeSave`. Return the data to save (or nothing to keep it),
	 * or throw `saveRejected(message)`. It must be plain browser code written for the site.
	 */
	beforeSave?: (event: BeforeSaveEvent) => unknown | Promise<unknown>;
	admin?: {
		entry?: string;
		pages?: Array<{ path: string; label?: string; icon?: string; group?: string }>;
		widgets?: Array<{ id: string; title?: string; size?: string }>;
		fieldWidgets?: Array<{ name: string; label: string; fieldTypes: string[]; elements?: unknown[] }>;
		portableTextBlocks?: unknown[];
		editorPanels?: unknown[];
		editorActions?: unknown[];
	};
}

export interface BrowserApiOptions {
	/** Plugins the admin should show. Their screens come from `pluginAdmins` on the admin itself. */
	plugins?: BrowserPlugin[];
	db: Kysely<any>;
	user: BrowserUser;
	apiBase: string;
	passthrough?: typeof fetch;
	/** Uploads not yet committed, keyed by storage key. Pass your own map to read or restore them. */
	pendingMedia?: Map<string, PendingFile>;
}

const fail = (code: string, message: string, status: number) =>
	Response.json({ success: false, error: { code, message } }, { status });

function manifestPlugins(plugins: BrowserPlugin[]) {
	const out: Record<string, unknown> = {};
	for (const plugin of plugins) {
		const a = plugin.admin;
		const hasExtensions = !!(a?.pages?.length || a?.widgets?.length || a?.editorPanels?.length || a?.editorActions?.length);
		out[plugin.id] = {
			version: plugin.version,
			enabled: true,
			adminMode: a?.entry ? "react" : hasExtensions ? "blocks" : "none",
			adminPages: a?.pages ?? [],
			dashboardWidgets: a?.widgets ?? [],
			portableTextBlocks: a?.portableTextBlocks,
			fieldWidgets: a?.fieldWidgets,
			editorPanels: a?.editorPanels,
			editorActions: a?.editorActions,
		};
	}
	return out;
}

async function buildManifest(db: Kysely<any>, plugins: BrowserPlugin[]) {
	const collections = await buildManifestCollections({}, db);
	const rows = await selectTaxonomyDefs(db).orderBy("d.name").execute();
	const taxonomies = rows.map((row) => ({
		id: row.id,
		name: row.name,
		label: row.label,
		labelSingular: row.label_singular ?? undefined,
		hierarchical: row.hierarchical === 1,
		collections: JSON.parse(row.collections ?? "[]").toSorted(),
		locale: row.locale,
		translationGroup: row.translation_group ?? row.id,
	}));
	const options = await new OptionsRepository(db).getMany<string>(["site:title", "site:timezone"]);
	const title = options.get("site:title");
	const timezone = options.get("site:timezone");
	const hash = JSON.stringify(collections).length + ":" + JSON.stringify(taxonomies).length;
	return {
		version: "browser",
		hash,
		collections,
		plugins: manifestPlugins(plugins),
		taxonomies,
		siteTitle: typeof title === "string" && title ? title : undefined,
		timezone: typeof timezone === "string" && timezone ? timezone : "UTC",
		staging: false,
		coEditing: false,
		authMode: "passkey",
		providerManagedName: false,
		signupEnabled: false,
		contentLocale: { defaultLocale: "en", implicit: true },
		marketplace: false,
		sandboxEnabled: false,
	};
}


export interface PendingFile {
	bytes: Uint8Array;
	contentType: string;
}

const MAX_UPLOAD = 10 * 1024 * 1024;

async function toBytes(body: Uint8Array | ReadableStream<Uint8Array>): Promise<Uint8Array> {
	if (body instanceof Uint8Array) return body;
	return new Uint8Array(await new Response(body).arrayBuffer());
}

/** Media storage for a static site: new uploads wait in memory until committed; committed files are plain files under <site>/media/. */
function makeStorage(siteBase: string, pending: Map<string, PendingFile>, passthrough: typeof fetch) {
	const publicUrl = (key: string) => `${siteBase}/media/${key}`;
	return {
		async upload({ key, body, contentType }: { key: string; body: Uint8Array | ReadableStream<Uint8Array>; contentType: string }) {
			const bytes = await toBytes(body);
			pending.set(key, { bytes, contentType });
			return { key, url: publicUrl(key), size: bytes.length };
		},
		async download(key: string) {
			const p = pending.get(key);
			if (p) return { body: new Response(p.bytes).body!, contentType: p.contentType, size: p.bytes.length };
			const res = await passthrough(publicUrl(key));
			if (!res.ok) throw new Error(`media file not found: ${key}`);
			const bytes = new Uint8Array(await res.arrayBuffer());
			return { body: new Response(bytes).body!, contentType: res.headers.get("content-type") ?? "application/octet-stream", size: bytes.length };
		},
		async delete(key: string) { pending.delete(key); },
		async exists(key: string) { return pending.has(key) || (await passthrough(publicUrl(key), { method: "HEAD" })).ok; },
		async list() { return { files: [] as never[] }; },
		async getSignedUploadUrl(): Promise<never> { throw Object.assign(new Error("Signed uploads are not available on a static site"), { code: "NOT_SUPPORTED" }); },
		getPublicUrl: publicUrl,
	};
}

// The runtime's handleXxx methods are thin wrappers over these handlers that add plugin hooks.
function makeEmdash(db: Kysely<any>, storage: ReturnType<typeof makeStorage>, plugins: BrowserPlugin[]) {
	const em: Record<string, any> = {
		db,
		config: { maxUploadSize: MAX_UPLOAD },
		hooks: undefined,
		storage,
		email: undefined,
		rooms: undefined,
		configuredPlugins: plugins.map((p) => ({
			capabilities: [],
			allowedHosts: [],
			storage: {},
			hooks: {},
			routes: {},
			...p,
			version: p.version ?? "0.0.0",
			admin: { pages: [], widgets: [], ...p.admin },
		})),
		sandboxedPluginEntries: [],
		getManifest: () => buildManifest(db, plugins),
		handleContentSchedule: (collection: string, id: string, scheduledAt: string, options: { _rev?: string } = {}) =>
			content.handleContentSchedule(db, collection, id, scheduledAt, new Date(), options._rev),
		handleCommentModerate: (id: string, status: any) => comments.handleCommentStatusChange(db, id, status),
		invalidateUrlPatternCache() {},
		ensureSearchHealthy: async () => {},
		isSandboxBypassed: () => true,
		getPluginMcpTools: () => [],
		getEnabledPluginMcpTools: () => [],
		getRuntimePluginSettingsSchema: () => undefined,
		getMediaProvider: () => undefined,
		getMediaProviderList: () => [],
		getSandboxRunner: () => null,
	};
	for (const mod of [content, media, revision] as Array<Record<string, any>>) {
		for (const [name, fn] of Object.entries(mod)) {
			if (name.startsWith("handle") && typeof fn === "function") em[name] ??= (...args: unknown[]) => fn(db, ...args);
		}
	}
	withBeforeSave(em, plugins);
	return em;
}

function withBeforeSave(em: Record<string, any>, plugins: BrowserPlugin[]) {
	const hooks = plugins.filter((p) => p.beforeSave);
	if (!hooks.length) return;
	const run = async (event: BeforeSaveEvent) => {
		let data = event.data;
		for (const p of hooks) {
			const out = await p.beforeSave!({ ...event, data });
			if (out && typeof out === "object") data = out as Record<string, unknown>;
		}
		return data;
	};
	const refusal = (error: unknown) => {
		if ((error as Error | undefined)?.name === "SaveRejected") {
			return { success: false, error: { code: "SAVE_REJECTED", message: (error as Error).message } };
		}
		console.error("[browser-api] beforeSave hook failed:", error);
		return { success: false, error: { code: "SAVE_HOOK_ERROR", message: "A plugin hook failed while saving" } };
	};
	const create = em.handleContentCreate;
	em.handleContentCreate = async (collection: string, body: { data?: Record<string, unknown> }, ...rest: unknown[]) => {
		if (!body?.data) return create(collection, body, ...rest);
		try {
			return create(collection, { ...body, data: await run({ data: body.data, collection, isNew: true }) }, ...rest);
		} catch (error) {
			return refusal(error);
		}
	};
	const update = em.handleContentUpdate;
	em.handleContentUpdate = async (collection: string, id: string, body: { data?: Record<string, unknown> }, ...rest: unknown[]) => {
		if (!body?.data) return update(collection, id, body, ...rest);
		try {
			return update(collection, id, { ...body, data: await run({ data: body.data, collection, isNew: false, id }) }, ...rest);
		} catch (error) {
			return refusal(error);
		}
	};
}

const rank = (pattern: string) =>
	pattern.split("/").filter(Boolean).map((s) => (s.startsWith("*") ? 0 : s.startsWith(":") ? 1 : 2));
const table = routeModules
	.map(([pattern, load]) => ({ pattern, segs: pattern.split("/").filter(Boolean), load, rank: rank(pattern) }))
	.toSorted((a, b) => {
		for (let i = 0; i < Math.max(a.rank.length, b.rank.length); i++) {
			const d = (b.rank[i] ?? -1) - (a.rank[i] ?? -1);
			if (d) return d;
		}
		return 0;
	});

function match(path: string) {
	const parts = path.split("/").filter(Boolean);
	for (const r of table) {
		const params: Record<string, string> = {};
		let okMatch = true;
		for (let i = 0; i < r.segs.length; i++) {
			const seg = r.segs[i]!;
			if (seg.startsWith("*")) {
				params[seg.slice(1)] = parts.slice(i).map(decodeURIComponent).join("/");
				return { r, params };
			}
			if (parts[i] === undefined) { okMatch = false; break; }
			if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(parts[i]!);
			else if (seg !== parts[i]) { okMatch = false; break; }
		}
		if (okMatch && r.segs.length === parts.length) return { r, params };
	}
	return null;
}

export function createBrowserApi({ db, user, apiBase, passthrough, pendingMedia, plugins = [] }: BrowserApiOptions) {
	const base = apiBase.replace(/\/+$/, "");
	const siteBase = base.replace(/\/_api$/, "");
	const pending = pendingMedia ?? new Map<string, PendingFile>();
	const realFetch: typeof fetch = passthrough ?? fetch.bind(globalThis);
	const emdash = makeEmdash(db, makeStorage(siteBase, pending, realFetch), plugins);
	const blobUrls = new Map<string, string>();
	// Admin screens load images with plain <img> tags, which can't reach this API, so media URLs point at the static file, or at a blob for an upload that isn't committed yet.
	const mediaUrl = (key: string) => {
		const p = pending.get(key);
		if (!p) return `${siteBase}/media/${key}`;
		if (!blobUrls.has(key)) blobUrls.set(key, URL.createObjectURL(new Blob([p.bytes], { type: p.contentType })));
		return blobUrls.get(key)!;
	};
	const rewriteMediaUrls = (value: unknown): unknown => {
		if (typeof value === "string") return value.replace(/\/_emdash\/api\/media\/file\/([^"?#\s]+)/g, (_m, key) => mediaUrl(decodeURIComponent(key)));
		if (Array.isArray(value)) return value.map(rewriteMediaUrls);
		if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteMediaUrls(v)]));
		return value;
	};
	const locals = { emdash, user: { ...user, role: ADMIN_ROLE, isFirstLogin: false } };
	const cookies = { get: () => undefined, has: () => false, set() {}, delete() {}, headers: () => [][Symbol.iterator]() };
	async function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const req = new Request(input, init);
		const url = new URL(req.url);
		const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : null;
		if (path === null) return (passthrough ?? fetch)(input, init);
		if (req.method === "GET" && path === "/auth/me") return Response.json({ success: true, data: locals.user });
		const found = match(path);
		if (!found) {
			console.warn("[browser-api] missing", req.method, path + url.search);
			return fail("NOT_FOUND", `${req.method} ${path} is not available on this static site`, 404);
		}
		try {
			const mod = await found.r.load();
			const handler = mod[req.method];
			if (!handler) return fail("METHOD_NOT_ALLOWED", `${req.method} ${path}`, 405);
			const res: Response = await handler({
				params: found.params, request: req, url, locals, cookies, cache: undefined, site: url.origin,
				clientAddress: "127.0.0.1", redirect: (to: string) => Response.redirect(new URL(to, url).href, 302),
			});
			if (path.startsWith("/media") && (res.headers.get("content-type") ?? "").includes("json")) {
				return Response.json(rewriteMediaUrls(await res.json()), { status: res.status });
			}
			return res;
		} catch (error) {
			console.error("[browser-api]", req.method, path, error);
			return fail("INTERNAL_ERROR", "The in-browser API failed", 500);
		}
	}
	return Object.assign(browserFetch, { pendingMedia: pending });
}
