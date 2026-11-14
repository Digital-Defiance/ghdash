import type { Kysely } from "kysely";

import { buildManifestCollections } from "../../packages/core/src/api/handlers/manifest.js";
import { unwrapResult } from "../../packages/core/src/api/error.js";
import * as content from "../../packages/core/src/api/handlers/content.js";
import { handleCommentCounts } from "../../packages/core/src/api/handlers/comments.js";
import { handleDashboardStats } from "../../packages/core/src/api/handlers/dashboard.js";
import { handleCoreUpdateStatus } from "../../packages/core/src/api/handlers/update-check.js";
import { contentCreateBody, contentListQuery, contentUpdateBody } from "../../packages/core/src/api/schemas/content.js";
import { handleEntryLockAcquire, handleEntryLockRead, handleEntryLockRelease } from "../../packages/core/src/api/handlers/entry-lock.js";
import { handleTaxonomyList } from "../../packages/core/src/api/handlers/taxonomies.js";
import { BylineRepository } from "../../packages/core/src/database/repositories/byline.js";
import { bylinesListQuery } from "../../packages/core/src/api/schemas/bylines.js";
import { OptionsRepository } from "../../packages/core/src/database/repositories/options.js";
import { selectTaxonomyDefs } from "../../packages/core/src/database/repositories/taxonomy-def.js";

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

interface Ctx {
	db: Kysely<any>;
	user: BrowserUser;
	url: URL;
	body: any;
	params: Record<string, string>;
}
type Handler = (ctx: Ctx) => Promise<Response | unknown>;

const ok = (data: unknown, status = 200) => Response.json({ success: true, data }, { status });
const fail = (code: string, message: string, status: number) =>
	Response.json({ success: false, error: { code, message } }, { status });

function parseWith(schema: { safeParse(v: unknown): any }, value: unknown): { value: any } | { error: Response } {
	const r = schema.safeParse(value);
	if (r.success) return { value: r.data };
	return { error: fail("VALIDATION_ERROR", r.error?.issues?.[0]?.message ?? "Invalid request", 400) };
}

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

const routes: Array<[string, string, Handler]> = [
	["GET", "/manifest", ({ db }) => buildManifest(db)],
	["GET", "/auth/me", async ({ user }) => ({ ...user, role: ADMIN_ROLE, isFirstLogin: false })],
	["GET", "/dashboard", async ({ db }) =>
		unwrapResult(await handleDashboardStats(db, { includeDrafts: true, includeMediaCount: true, includeUserCount: false }))],
	["GET", "/admin/comments/counts", async ({ db }) => unwrapResult(await handleCommentCounts(db))],
	["GET", "/admin/core-update", async ({ db }) => unwrapResult(await handleCoreUpdateStatus(db, { enabled: false }))],

	["GET", "/taxonomies", async ({ db, url }) =>
		unwrapResult(await handleTaxonomyList(db, { locale: url.searchParams.get("locale") || undefined }))],
	["GET", "/admin/bylines", async ({ db, url }) => {
		const q = parseWith(bylinesListQuery as any, Object.fromEntries(url.searchParams));
		if ("error" in q) return q.error;
		const { search, isGuest, userId, locale, cursor, limit } = q.value;
		return new BylineRepository(db).findMany({ search, isGuest, userId, locale, cursor, limit });
	}],
	["GET", "/admin/users", async ({ user }) => ({
		items: [{ id: user.id, email: user.email, name: user.name ?? null, avatarUrl: user.avatarUrl ?? null, role: ADMIN_ROLE,
			emailVerified: true, disabled: false, createdAt: "", updatedAt: "", lastLogin: null, credentialCount: 0, oauthProviders: ["github"] }],
	})],
	["GET", "/content/:collection/:id/lock", async ({ db, user, params }) =>
		unwrapResult(await handleEntryLockRead(db, params.collection!, params.id!, user.id))],
	["POST", "/content/:collection/:id/lock", async ({ db, user, body, params }) =>
		unwrapResult(await handleEntryLockAcquire(db, params.collection!, params.id!, user.id, { takeover: body?.takeover, token: body?.token }))],
	["DELETE", "/content/:collection/:id/lock", async ({ db, user, url, params }) =>
		unwrapResult(await handleEntryLockRelease(db, params.collection!, params.id!, user.id, { token: url.searchParams.get("token") ?? undefined }))],
	["GET", "/content/:collection", async ({ db, url, params }) => {
		const q = parseWith(contentListQuery as any, Object.fromEntries(url.searchParams));
		if ("error" in q) return q.error;
		return unwrapResult(await content.handleContentList(db, params.collection!, q.value));
	}],
	["POST", "/content/:collection", async ({ db, user, body, params }) => {
		const b = parseWith(contentCreateBody as any, body);
		if ("error" in b) return b.error;
		return unwrapResult(await content.handleContentCreate(db, params.collection!, { ...b.value, authorId: user.id }), 201);
	}],
	["GET", "/content/:collection/:id", async ({ db, url, params }) =>
		unwrapResult(await content.handleContentGet(db, params.collection!, params.id!, url.searchParams.get("locale") || undefined, { includeDrafts: true }))],
	["PUT", "/content/:collection/:id", async ({ db, url, body, params }) => {
		const b = parseWith(contentUpdateBody as any, body);
		if ("error" in b) return b.error;
		const { overrideLock: _ignored, ...rest } = b.value;
		const locale = url.searchParams.get("locale") || undefined;
		return unwrapResult(await content.handleContentUpdate(db, params.collection!, params.id!, { ...rest, locale }));
	}],
	["DELETE", "/content/:collection/:id", async ({ db, params }) =>
		unwrapResult(await content.handleContentDelete(db, params.collection!, params.id!))],
	["POST", "/content/:collection/:id/publish", async ({ db, body, params }) =>
		unwrapResult(await content.handleContentPublish(db, params.collection!, params.id!, body ?? {}))],
	["POST", "/content/:collection/:id/unpublish", async ({ db, params }) =>
		unwrapResult(await content.handleContentUnpublish(db, params.collection!, params.id!))],
	["POST", "/content/:collection/:id/discard-draft", async ({ db, params }) =>
		unwrapResult(await content.handleContentDiscardDraft(db, params.collection!, params.id!))],
];

function match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
	const parts = path.split("/").filter(Boolean);
	for (const [m, pattern, handler] of routes) {
		if (m !== method) continue;
		const pp = pattern.split("/").filter(Boolean);
		if (pp.length !== parts.length) continue;
		const params: Record<string, string> = {};
		if (pp.every((seg, i) => (seg.startsWith(":") ? ((params[seg.slice(1)] = decodeURIComponent(parts[i]!)), true) : seg === parts[i]))) {
			return { handler, params };
		}
	}
	return null;
}

export function createBrowserApi({ db, user, apiBase, passthrough }: BrowserApiOptions) {
	const base = apiBase.replace(/\/+$/, "");
	return async function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const req = new Request(input, init);
		const url = new URL(req.url);
		const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : null;
		if (path === null) return (passthrough ?? fetch)(input, init);
		const found = match(req.method, path);
		if (!found) {
			console.warn("[browser-api] missing", req.method, path + url.search);
			return fail("NOT_FOUND", `${req.method} ${path} is not available on this static site`, 404);
		}
		try {
			const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.json().catch(() => undefined);
			const out = await found.handler({ db, user, url, body, params: found.params });
			return out instanceof Response ? out : ok(out);
		} catch (error) {
			console.error("[browser-api]", req.method, path, error);
			return fail("INTERNAL_ERROR", "The in-browser API failed", 500);
		}
	};
}
