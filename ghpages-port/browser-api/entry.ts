import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;
export { createBrowserApi } from "./router.js";
export type { BrowserUser, BrowserApiOptions } from "./router.js";
export { Kysely, SqliteDialect } from "../../packages/core/node_modules/kysely/dist/index.js";
import { publishDueContent } from "../../packages/core/src/scheduled-publish.js";
/** Publishes every entry whose scheduled time has passed, as the platform scheduler would. Returns what it published. */
export const publishDue = (db: any, currentTime: Date = new Date()) => publishDueContent(db, { currentTime, limit: 0 });
