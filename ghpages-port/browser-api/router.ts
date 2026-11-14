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

export interface BrowserApiOptions {
	db: Kysely<any>;
	user: BrowserUser;
	apiBase: string;
	passthrough?: typeof fetch;
}

const fail = (code: string, message: string, status: number) =>
	Response.json({ success: false, error: { code, message } }, { status });

async function buildManifest(db: Kysely<any>) {
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
		plugins: {},
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


// The runtime's handleXxx methods are thin wrappers over these handlers that add plugin hooks.
function makeEmdash(db: Kysely<any>) {
	const em: Record<string, any> = {
		db,
		config: {},
		hooks: undefined,
		storage: undefined,
		email: undefined,
		rooms: undefined,
		configuredPlugins: [],
		sandboxedPluginEntries: [],
		getManifest: () => buildManifest(db),
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
	return em;
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

export function createBrowserApi({ db, user, apiBase, passthrough }: BrowserApiOptions) {
	const base = apiBase.replace(/\/+$/, "");
	const emdash = makeEmdash(db);
	const locals = { emdash, user: { ...user, role: ADMIN_ROLE, isFirstLogin: false } };
	const cookies = { get: () => undefined, has: () => false, set() {}, delete() {}, headers: () => [][Symbol.iterator]() };
	return async function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
			return await handler({
				params: found.params, request: req, url, locals, cookies, cache: undefined, site: url.origin,
				clientAddress: "127.0.0.1", redirect: (to: string) => Response.redirect(new URL(to, url).href, 302),
			});
		} catch (error) {
			console.error("[browser-api]", req.method, path, error);
			return fail("INTERNAL_ERROR", "The in-browser API failed", 500);
		}
	};
}
