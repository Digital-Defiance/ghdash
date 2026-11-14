import type { Kysely } from "kysely";

import { buildManifestCollections } from "../../packages/core/src/api/handlers/manifest.js";
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

type Handler = (ctx: { db: Kysely<any>; user: BrowserUser; url: URL; body: unknown }) => Promise<unknown>;

const ok = (data: unknown, status = 200) => Response.json({ success: true, data }, { status });
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

const routes: Record<string, Handler> = {
	"GET /manifest": ({ db }) => buildManifest(db),
	"GET /auth/me": async ({ user }) => ({ ...user, role: ADMIN_ROLE, isFirstLogin: false }),
};

export function createBrowserApi({ db, user, apiBase, passthrough }: BrowserApiOptions) {
	const base = apiBase.replace(/\/+$/, "");
	return async function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const req = new Request(input, init);
		const url = new URL(req.url);
		const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : null;
		if (path === null) return (passthrough ?? fetch)(input, init);
		const handler = routes[`${req.method} ${path.replace(/\/+$/, "") || "/"}`];
		if (!handler) return fail("NOT_FOUND", `${req.method} ${path} is not available on this static site`, 404);
		try {
			const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.json().catch(() => undefined);
			return ok(await handler({ db, user, url, body }));
		} catch (error) {
			console.error("[browser-api]", req.method, path, error);
			return fail("INTERNAL_ERROR", "The in-browser API failed", 500);
		}
	};
}
