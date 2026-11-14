import type { QueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";

/**
 * Where the admin lives and where its API is, for deployments that don't serve
 * the admin at /_emdash/admin (for example a static site under a base path).
 *
 * Set `globalThis.__EMDASH_PATHS__` before the admin bundle loads. Every field
 * is optional and the defaults match a standard EmDash install.
 */
export interface EmDashPaths {
	/** Path the admin SPA is served from, without a trailing slash. */
	adminBase?: string;
	/** Path prefix of the HTTP API, without a trailing slash. */
	apiBase?: string;
	/** Replaces `fetch` for every `apiFetch` call, so the API can run without a server. */
	fetch?: typeof fetch;
	/** Rendered in the header, before the "View Site" link. */
	HeaderExtras?: ComponentType;
	/** Called once with the admin's query client, so a host that changes data behind the API can reset cached screens. */
	onQueryClient?: (client: QueryClient) => void;
}

const configured = (globalThis as { __EMDASH_PATHS__?: EmDashPaths }).__EMDASH_PATHS__;
const TRAILING_SLASHES = /\/+$/;
const trim = (value: string) => value.replace(TRAILING_SLASHES, "");

export const DEFAULT_ADMIN_BASE = "/_emdash/admin";
export const DEFAULT_API_BASE = "/_emdash/api";

export const ADMIN_BASE = trim(configured?.adminBase ?? DEFAULT_ADMIN_BASE);
export const API_BASE = trim(configured?.apiBase ?? DEFAULT_API_BASE);
export const customFetch = configured?.fetch;
export const HeaderExtras = configured?.HeaderExtras;
export const onQueryClient = configured?.onQueryClient;

/** Rewrites a hardcoded `/_emdash/api...` URL to the configured API prefix. */
export function resolveApiUrl<T extends string | URL | Request>(input: T): T {
	if (API_BASE === DEFAULT_API_BASE || typeof input !== "string") return input;
	if (input === DEFAULT_API_BASE || input.startsWith(`${DEFAULT_API_BASE}/`) || input.startsWith(`${DEFAULT_API_BASE}?`)) {
		return `${API_BASE}${input.slice(DEFAULT_API_BASE.length)}` as T;
	}
	return input;
}
