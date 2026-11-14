import { checkAccess, commitFiles, getHead, GitHubError } from "./github-commit.js";
import { applyFile, canonical, diffFiles, mergeRemote, snapshot } from "./tray.js";

const TOKEN_KEY = "ghdash-token";
const API = "https://api.github.com";

const safe = (f, fallback) => { try { return f(); } catch { return fallback; } };

function idb(name = "ghdash-studio") {
	const open = () =>
		new Promise((resolve, reject) => {
			const r = indexedDB.open(name, 1);
			r.onupgradeneeded = () => r.result.createObjectStore("pending");
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
	const run = async (mode, fn) => {
		const db = await open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction("pending", mode);
			const req = fn(tx.objectStore("pending"));
			tx.oncomplete = () => { db.close(); resolve(req?.result); };
			tx.onerror = () => reject(tx.error);
		});
	};
	return {
		get: (key) => run("readonly", (s) => s.get(key)),
		set: (key, value) => run("readwrite", (s) => s.put(value, key)),
		del: (key) => run("readwrite", (s) => s.delete(key)),
	};
}

const MEDIA = "@media/";
const mediaRows = (files) => { const t = files.get("media.json"); return t ? JSON.parse(t) : []; };

export function createController({ db, freshNames, baseFiles, meta, pendingMedia = new Map(), fetchImpl = globalThis.fetch.bind(globalThis), storage = safe(() => sessionStorage, null), store = safe(() => idb(), null) }) {
	const [owner, repo] = meta.repo.split("/");
	const prefix = "content/";
	let base = baseFiles;
	let head = meta.head;
	let state = { changes: [], hasToken: Boolean(storage?.getItem(TOKEN_KEY)), status: { kind: "idle" }, head };
	const listeners = new Set();
	const external = new Set();
	const changedExternally = () => external.forEach((l) => l());
	const set = (patch) => { state = { ...state, ...patch, head }; listeners.forEach((l) => l()); };
	const storeKey = `${meta.repo}#${meta.branch}`;
	const token = () => storage?.getItem(TOKEN_KEY) ?? null;

	/** Uploads and deletions of media files, shown as their own changes instead of the media table's rows. */
	function mediaDiff(cur) {
		const before = new Map(mediaRows(base).map((r) => [r.storage_key, r]));
		const after = new Map(mediaRows(cur).map((r) => [r.storage_key, r]));
		const out = [];
		for (const [key, row] of after) if (!before.has(key) && pendingMedia.has(key)) out.push({ path: MEDIA + key, kind: "added", group: "Media", label: row.filename || key, discardable: true });
		for (const [key, row] of before) if (!after.has(key)) out.push({ path: MEDIA + key, kind: "deleted", group: "Media", label: row.filename || key, discardable: true });
		return out;
	}

	function changesFor(cur) {
		const media = mediaDiff(cur);
		const json = diffFiles(base, cur);
		return media.length ? [...json.filter((c) => c.path !== "media.json"), ...media].sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)) : json;
	}

	async function persist(cur) {
		if (!store) return;
		const files = {};
		for (const c of diffFiles(base, cur)) files[c.path] = cur.get(c.path) ?? null;
		const media = {};
		for (const c of mediaDiff(cur)) if (c.kind === "added") media[c.path.slice(MEDIA.length)] = pendingMedia.get(c.path.slice(MEDIA.length));
		try {
			if (Object.keys(files).length) await store.set(storeKey, { head, files, media });
			else await store.del(storeKey);
		} catch { /* IndexedDB can be blocked; the in-memory state still works */ }
	}

	function refresh() {
		const cur = snapshot(db, freshNames);
		set({ changes: changesFor(cur) });
		void persist(cur);
	}

	let timer;
	const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 100); };

	async function restore() {
		if (!store) return;
		const saved = await store.get(storeKey).catch(() => null);
		if (!saved) return;
		if (saved.head !== head) { await store.del(storeKey).catch(() => {}); return; }
		for (const [key, file] of Object.entries(saved.media ?? {})) pendingMedia.set(key, file);
		for (const [path, text] of Object.entries(saved.files)) applyFile(db, path, text);
		refresh();
		changedExternally();
	}

	async function fetchRemote(ref) {
		const gh = async (path) => {
			const res = await fetchImpl(`${API}${path}`, { headers: { Accept: "application/vnd.github+json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}) } });
			if (!res.ok) throw new GitHubError(res.status, await res.json().catch(() => null));
			return res.json();
		};
		const tree = await gh(`/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`);
		const files = new Map();
		const blobs = tree.tree.filter((n) => n.type === "blob" && n.path.startsWith(prefix) && n.path.endsWith(".json"));
		for (let i = 0; i < blobs.length; i += 8) {
			await Promise.all(blobs.slice(i, i + 8).map(async (n) => {
				const b = await gh(`/repos/${owner}/${repo}/git/blobs/${n.sha}`);
				const bytes = Uint8Array.from(atob(b.content.replace(/\s/g, "")), (c) => c.charCodeAt(0));
				files.set(n.path.slice(prefix.length), canonical(new TextDecoder().decode(bytes)));
			}));
		}
		return files;
	}

	async function updateFromRemote() {
		set({ status: { kind: "updating" } });
		try {
			const remoteHead = await getHead({ token: token(), owner, repo, branch: meta.branch, fetchImpl });
			const remote = await fetchRemote(remoteHead);
			const local = snapshot(db, freshNames);
			const clashes = mergeRemote(db, base, remote, local);
			const ddlBase = base.get("_ddl.json");
			base = remote;
			// Schema changes from the remote can't be applied to this database, so the schema baseline stays ours.
			if (ddlBase !== undefined) base.set("_ddl.json", ddlBase);
			head = remoteHead;
			refresh();
			changedExternally();
			set({ status: clashes.length ? { kind: "clashes", paths: clashes } : { kind: "idle" } });
		} catch (e) {
			set({ status: { kind: "error", message: describeError(e) } });
		}
	}

	function discardOne(path) {
		if (!path.startsWith(MEDIA)) { applyFile(db, path, base.get(path) ?? null); return; }
		const key = path.slice(MEDIA.length);
		const row = mediaRows(base).find((r) => r.storage_key === key);
		if (row) {
			const cols = Object.keys(row);
			db.exec({ sql: `insert or replace into media (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`, bind: cols.map((c) => (typeof row[c] === "boolean" ? Number(row[c]) : row[c])) });
		} else {
			db.exec({ sql: "delete from media where storage_key = ?", bind: [key] });
			pendingMedia.delete(key);
		}
	}

	function describeError(e) {
		if (e instanceof GitHubError) {
			if (e.status === 401) { storage?.removeItem(TOKEN_KEY); set({ hasToken: false }); return "GitHub rejected the token. Paste a new one."; }
			if (e.status === 403 || e.status === 404) return "The token can't write to this repository. It needs Contents: read and write for this repo.";
			return e.message;
		}
		return e instanceof Error ? e.message : String(e);
	}

	return {
		getState: () => state,
		subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
		refresh, schedule, restore, updateFromRemote,
		/** Called when the database changed behind the admin's back, so it can drop cached screens. */
		onExternalChange(l) { external.add(l); return () => external.delete(l); },
		discard(path) {
			discardOne(path);
			refresh();
			changedExternally();
		},
		discardAll() {
			for (const c of state.changes) if (c.discardable) discardOne(c.path);
			refresh();
			changedExternally();
		},
		async signIn(value) {
			set({ status: { kind: "checking" } });
			try {
				const { canPush } = await checkAccess({ token: value, owner, repo, fetchImpl });
				if (!canPush) throw new Error("This token can read the repository but not push to it.");
				storage?.setItem(TOKEN_KEY, value);
				set({ hasToken: true, status: { kind: "idle" } });
			} catch (e) {
				set({ status: { kind: "error", message: describeError(e) } });
			}
		},
		signOut() { storage?.removeItem(TOKEN_KEY); set({ hasToken: false }); },
		async commit(message) {
			if (!token()) return;
			set({ status: { kind: "committing" } });
			const cur = snapshot(db, freshNames);
			const files = {};
			for (const c of diffFiles(base, cur)) files[prefix + c.path] = cur.get(c.path) ?? null;
			for (const c of mediaDiff(cur)) files[c.path.slice(1)] = c.kind === "added" ? pendingMedia.get(c.path.slice(MEDIA.length)).bytes : null;
			try {
				const r = await commitFiles({ token: token(), owner, repo, branch: meta.branch, files, message: message || "Update content from the studio", expectedHeadSha: head, fetchImpl });
				if (!r.ok) { set({ status: { kind: "conflict", remoteHead: r.headSha } }); return; }
				base = cur;
				head = r.commitSha;
				refresh();
				set({ status: { kind: "done", sha: r.commitSha } });
			} catch (e) {
				set({ status: { kind: "error", message: describeError(e) } });
			}
		},
		get repoInfo() { return { owner, repo, branch: meta.branch }; },
	};
}
