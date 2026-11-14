import "@emdash-cms/admin/styles.css";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { Fragment } from "react";
import { createRoot } from "react-dom/client";

import { createController } from "./controller.js";
import { openDb } from "./load-db.js";
import { makeTray } from "./Tray.js";
import { snapshot } from "./tray.js";

const paths = (globalThis as any).__EMDASH_PATHS__ as { adminBase: string; apiBase: string };
// Sites that use plugins set this before loading the studio: `plugins` are the definitions the manifest needs, `admins` the plugins' admin modules.
const studioPlugins = ((globalThis as any).__STUDIO_PLUGINS__ ?? { plugins: [], admins: {} }) as { plugins: unknown[]; admins: Record<string, unknown> };
const root = document.getElementById("admin-root")!;
root.textContent = "Loading site data…";

const site = paths.apiBase.replace(/\/_api$/, "");
const { createBrowserApi, Kysely, SqliteDialect } = await import(/* @vite-ignore */ `${site}/studio-api/entry.js`);
const [sqlite, content, empty] = await Promise.all([
	sqlite3InitModule({ print() {}, printErr() {} }),
	fetch(`${site}/studio-data/content.json`).then((r) => r.json()),
	fetch(`${site}/studio-data/empty.db`).then((r) => r.arrayBuffer()),
]);
const { db: raw, database, freshNames } = openDb(sqlite, empty, content);
const db = new Kysely({ dialect: new SqliteDialect({ database }) });
const realFetch = globalThis.fetch.bind(globalThis);
const pendingMedia = new Map();
const controller = createController({ db: raw, freshNames, baseFiles: snapshot(raw, freshNames), meta: content.meta, pendingMedia });
const rawApi = createBrowserApi({
	db,
	apiBase: paths.apiBase,
	user: { id: "github-user", email: "editor@users.noreply.github.com", name: "GitHub editor" },
	passthrough: realFetch,
	pendingMedia,
	plugins: studioPlugins.plugins,
});
const api: typeof fetch = async (input, init) => {
	const res = await rawApi(input, init);
	if ((init?.method ?? (input instanceof Request ? input.method : "GET")) !== "GET") controller.schedule();
	return res;
};
let queryClient: { resetQueries(): Promise<void> } | undefined;
(globalThis as any).__EMDASH_PATHS__ = {
	...paths,
	fetch: api,
	HeaderExtras: makeTray(controller as any),
	onQueryClient: (client: typeof queryClient) => { queryClient = client; },
};
await controller.restore();

const { AdminApp } = await import("@emdash-cms/admin");
const { loadMessages } = await import("@emdash-cms/admin/locales");
const messages = await loadMessages("en");
root.textContent = "";
const reactRoot = createRoot(root);
let generation = 0;
const render = () =>
	reactRoot.render(
		<Fragment key={generation}>
			<AdminApp locale="en" messages={messages} pluginAdmins={studioPlugins.admins as any} />
		</Fragment>,
	);
controller.onExternalChange(() => {
	generation += 1;
	render();
	void queryClient?.resetQueries();
});
render();
