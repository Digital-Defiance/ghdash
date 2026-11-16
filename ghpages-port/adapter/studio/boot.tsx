import "@emdash-cms/admin/styles.css";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { Fragment } from "react";
import { createRoot } from "react-dom/client";

import { createController } from "./controller.js";
import { openDb } from "./load-db.js";
import { makeTray } from "./Tray.js";
import { snapshot } from "./tray.js";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the page sets this global before the studio loads
const paths = (globalThis as any).__EMDASH_PATHS__ as { adminBase: string; apiBase: string };
// Sites that use plugins set this before loading the studio: `plugins` are the definitions the manifest needs, `admins` the plugins' admin modules.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the site page sets this global before the studio loads
const studioPlugins = ((globalThis as any).__STUDIO_PLUGINS__ ?? { plugins: [], admins: {} }) as {
	plugins: unknown[];
	admins: Record<string, unknown>;
};
const root = document.getElementById("admin-root")!;
root.textContent = "Loading site data…";

const site = paths.apiBase.replace(/\/_api$/, "");
const { createBrowserApi, Kysely, SqliteDialect } = await import(
	/* @vite-ignore */ `${site}/studio-api/entry.js`
);
const [sqlite, content, empty] = await Promise.all([
	sqlite3InitModule({ print() {}, printErr() {} }),
	fetch(`${site}/studio-data/content.json`).then((r) => r.json()),
	fetch(`${site}/studio-data/empty.db`).then((r) => r.arrayBuffer()),
]);
const { db: raw, database, freshNames } = openDb(sqlite, empty, content);
const db = new Kysely({ dialect: new SqliteDialect({ database }) });
const realFetch = globalThis.fetch.bind(globalThis);
const pendingMedia = new Map();
if ("serviceWorker" in navigator) {
	navigator.serviceWorker.addEventListener("message", (e) => {
		if (e.data?.type === "studio-media")
			e.ports[0]?.postMessage(pendingMedia.get(e.data.key) ?? null);
	});
	navigator.serviceWorker.register(`${site}/studio/media-sw.js`).catch(() => {});
}
// Sites that offer "Sign in with GitHub" set this before loading the studio: `clientId` of their GitHub App and `exchangeUrl` of the token-exchange Worker.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the site page sets this global before the studio loads
const studioOAuth = (globalThis as any).__STUDIO_OAUTH__ as
	| { clientId: string; exchangeUrl: string }
	| undefined;
const studioUrl = `${location.origin}${location.pathname}`;
const controller = createController({
	db: raw,
	freshNames,
	baseFiles: snapshot(raw, freshNames),
	meta: content.meta,
	pendingMedia,
	oauth:
		studioOAuth?.clientId && studioOAuth?.exchangeUrl
			? { ...studioOAuth, redirectUri: studioUrl }
			: null,
});
const rawApi = createBrowserApi({
	db,
	apiBase: paths.apiBase,
	user: {
		id: "github-user",
		email: "editor@users.noreply.github.com",
		name: content.meta.provider === "gitlab" ? "GitLab editor" : "GitHub editor",
	},
	passthrough: realFetch,
	pendingMedia,
	plugins: studioPlugins.plugins,
});
const api: typeof fetch = async (input, init) => {
	const res = await rawApi(input, init);
	if ((init?.method ?? (input instanceof Request ? input.method : "GET")) !== "GET")
		controller.schedule();
	return res;
};
let queryClient: { resetQueries(): Promise<void> } | undefined;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the admin bundle reads this global when it loads
(globalThis as any).__EMDASH_PATHS__ = {
	...paths,
	fetch: api,
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- makeTray only uses the controller methods the tray renders
	HeaderExtras: makeTray(controller as any),
	onQueryClient: (client: typeof queryClient) => {
		queryClient = client;
	},
};
await controller.restore();
if (await controller.finishOAuth(location.search))
	history.replaceState(null, "", studioUrl + location.hash);

const { AdminApp } = await import("@emdash-cms/admin");
const { loadMessages } = await import("@emdash-cms/admin/locales");
const messages = await loadMessages("en");
root.textContent = "";
const reactRoot = createRoot(root);
let generation = 0;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- plugin admin modules come from the site page, shaped as AdminApp expects
const pluginAdmins = studioPlugins.admins as any;
const render = () =>
	reactRoot.render(
		<Fragment key={generation}>
			<AdminApp locale="en" messages={messages} pluginAdmins={pluginAdmins} />
		</Fragment>,
	);
controller.onExternalChange(() => {
	generation += 1;
	render();
	void queryClient?.resetQueries();
});
render();
