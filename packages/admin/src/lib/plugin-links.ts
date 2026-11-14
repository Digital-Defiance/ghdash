import { isSafePluginPagePath, normalizePluginPagePath, type LinkTarget } from "@emdash-cms/blocks";
import { ADMIN_BASE } from "./paths.js";

export function resolvePluginLinkTarget(pluginId: string, target: LinkTarget): string | null {
	switch (target.kind) {
		case "content": {
			if (!target.collection || !target.id) return null;
			const url = `${ADMIN_BASE}/content/${encodeURIComponent(target.collection)}/${encodeURIComponent(target.id)}`;
			return target.locale ? `${url}?locale=${encodeURIComponent(target.locale)}` : url;
		}
		case "plugin-page": {
			const path = normalizePluginPagePath(target.path);
			if (!isSafePluginPagePath(path)) return null;
			return `${ADMIN_BASE}/plugins/${encodeURIComponent(pluginId)}${path}`;
		}
		case "plugin-settings":
			return `${ADMIN_BASE}/plugins-manager/${encodeURIComponent(pluginId)}/settings`;
		case "external": {
			try {
				const url = new URL(target.url);
				return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:"
					? url.href
					: null;
			} catch {
				return null;
			}
		}
	}
}
