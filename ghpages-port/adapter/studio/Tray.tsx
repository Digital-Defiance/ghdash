import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Change = { path: string; kind: "added" | "modified" | "deleted"; group: string; label: string; discardable: boolean };
type Status =
	| { kind: "idle" | "checking" | "committing" | "updating" }
	| { kind: "error"; message: string }
	| { kind: "conflict"; remoteHead: string }
	| { kind: "clashes"; paths: string[] }
	| { kind: "done"; sha: string };
type State = { changes: Change[]; hasToken: boolean; status: Status };
type Controller = {
	getState(): State;
	subscribe(l: () => void): () => void;
	discard(path: string): void;
	discardAll(): void;
	signIn(token: string): Promise<void>;
	signOut(): void;
	commit(message: string): Promise<void>;
	updateFromRemote(): Promise<void>;
	repoInfo: { owner: string; repo: string; branch: string };
};

const KIND_LABEL = { added: "New", modified: "Edited", deleted: "Deleted" } as const;
const KIND_COLOR = { added: "var(--color-kumo-success)", modified: "var(--color-kumo-info)", deleted: "var(--color-kumo-danger)" } as const;

const box = { border: "1px solid var(--color-kumo-line)", borderRadius: 8, background: "var(--color-kumo-base)", color: "var(--text-color-kumo-default)" } as const;
const field = { ...box, width: "100%", padding: "6px 8px", fontSize: 13, boxSizing: "border-box" } as const;
const btn = (primary = false, disabled = false) =>
	({
		padding: "6px 12px", borderRadius: 6, fontSize: 13, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
		border: primary ? "none" : "1px solid var(--color-kumo-line)",
		background: primary ? "var(--color-kumo-brand)" : "transparent",
		color: primary ? "#fff" : "var(--text-color-kumo-default)",
	}) as const;

export function makeTray(c: Controller) {
	return function Tray() {
		const s = useSyncExternalStore(c.subscribe, c.getState);
		const [open, setOpen] = useState(false);
		const [message, setMessage] = useState("");
		const [token, setToken] = useState("");
		const root = useRef<HTMLDivElement>(null);
		const n = s.changes.length;
		const busy = ["committing", "updating", "checking"].includes(s.status.kind);

		useEffect(() => {
			if (!open) return;
			const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
			document.addEventListener("mousedown", close);
			return () => document.removeEventListener("mousedown", close);
		}, [open]);

		const { owner, repo, branch } = c.repoInfo;
		return (
			<div ref={root} style={{ position: "relative" }}>
				<button
					type="button"
					aria-label="Pending changes"
					aria-expanded={open}
					data-testid="tray-button"
					onClick={() => setOpen(!open)}
					style={{ ...btn(), display: "flex", alignItems: "center", gap: 6, borderColor: n ? "var(--color-kumo-brand)" : "var(--color-kumo-line)" }}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
						<circle cx="12" cy="12" r="3.5" /><path d="M2 12h6.5M15.5 12H22" />
					</svg>
					<span data-testid="tray-count" style={{ fontVariantNumeric: "tabular-nums" }}>{n}</span>
				</button>
				{open && (
					<div role="dialog" aria-label="Pending changes" style={{ ...box, position: "absolute", insetInlineEnd: 0, top: "calc(100% + 6px)", width: 380, maxWidth: "90vw", padding: 12, zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,.18)", background: "var(--color-kumo-elevated)" }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
							<strong style={{ fontSize: 14 }}>Pending changes</strong>
							{n > 0 && <button type="button" onClick={() => c.discardAll()} style={{ ...btn(), padding: "2px 8px", fontSize: 12 }}>Discard all</button>}
						</div>
						{n === 0 ? (
							<p style={{ fontSize: 13, color: "var(--text-color-kumo-subtle)", margin: "8px 0" }}>Nothing to commit. Edits you make appear here until you commit them to {owner}/{repo}.</p>
						) : (
							<ul data-testid="tray-list" style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 240, overflow: "auto", display: "grid", gap: 4 }}>
								{s.changes.map((ch) => (
									<li key={ch.path} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0" }}>
										<span style={{ color: KIND_COLOR[ch.kind], fontSize: 11, fontWeight: 600, minWidth: 52 }}>{KIND_LABEL[ch.kind]}</span>
										<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ch.path}>
											<span style={{ color: "var(--text-color-kumo-subtle)" }}>{ch.group}: </span>{ch.label}
										</span>
										{ch.discardable && <button type="button" aria-label={`Discard ${ch.label}`} onClick={() => c.discard(ch.path)} style={{ ...btn(), padding: "1px 8px", fontSize: 12 }}>Discard</button>}
									</li>
								))}
							</ul>
						)}

						{s.status.kind === "conflict" && (
							<div role="alert" style={{ marginTop: 10, fontSize: 13 }}>
								<p style={{ margin: "0 0 6px", color: "var(--text-color-kumo-warning)" }}>Someone changed {branch} since you loaded the site. Your changes are kept.</p>
								<button type="button" onClick={() => void c.updateFromRemote()} style={btn(true)}>Update my copy and keep my changes</button>
							</div>
						)}
						{s.status.kind === "clashes" && (
							<p role="alert" style={{ marginTop: 10, fontSize: 13, color: "var(--text-color-kumo-warning)" }}>
								Updated. {s.status.paths.length} {s.status.paths.length === 1 ? "item was" : "items were"} also changed upstream; your version is kept and will replace theirs when you commit.
							</p>
						)}
						{s.status.kind === "error" && <p role="alert" style={{ marginTop: 10, fontSize: 13, color: "var(--text-color-kumo-danger)" }}>{s.status.message}</p>}
						{s.status.kind === "done" && (
							<p role="status" data-testid="tray-done" style={{ marginTop: 10, fontSize: 13, color: "var(--text-color-kumo-success)" }}>
								Committed <a href={`https://github.com/${owner}/${repo}/commit/${s.status.sha}`} target="_blank" rel="noreferrer">{s.status.sha.slice(0, 7)}</a>. The site rebuilds in a minute or two: <a href={`https://github.com/${owner}/${repo}/actions`} target="_blank" rel="noreferrer">watch the build</a>.
							</p>
						)}

						{!s.hasToken ? (
							<form style={{ marginTop: 10, display: "grid", gap: 6 }} onSubmit={(e) => { e.preventDefault(); void c.signIn(token.trim()); }}>
								<label style={{ fontSize: 12, color: "var(--text-color-kumo-subtle)" }} htmlFor="tray-token">
									GitHub token to commit to {owner}/{repo} (fine-grained, Contents: read and write). Kept in this tab only.
								</label>
								<input id="tray-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} style={field} />
								<button type="submit" disabled={!token.trim() || busy} style={btn(true, !token.trim() || busy)}>Sign in</button>
							</form>
						) : (
							<div style={{ marginTop: 10, display: "grid", gap: 6 }}>
								<label className="sr-only" htmlFor="tray-message" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Commit message</label>
								<input id="tray-message" placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} style={field} />
								<div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
									<button type="button" onClick={() => c.signOut()} style={{ ...btn(), fontSize: 12 }}>Sign out</button>
									<button type="button" disabled={n === 0 || busy} onClick={() => void c.commit(message).then(() => setMessage(""))} style={btn(true, n === 0 || busy)}>
										{s.status.kind === "committing" ? "Committing…" : `Commit ${n || ""} to ${branch}`}
									</button>
								</div>
							</div>
						)}
					</div>
				)}
			</div>
		);
	};
}
