// ghdash-pages run-cron [--since <iso>] [--now <iso>]
// Runs the `cron` hook of plugins in hooks.config.json whose `cron` jobs fell due since the last run (default: the last hour).
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { dueCronEvents } from "./cron.mjs";
import { runHooks } from "./hooks-runner.mjs";

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const configPath = "hooks.config.json";
if (!existsSync(configPath)) {
	console.log("no hooks.config.json, nothing to run");
	process.exit(0);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
const now = new Date(arg("now") ?? Date.now());
const since = new Date(arg("since") ?? now.getTime() - 3600_000);
const configured = (config.plugins ?? []).filter((p) => p.cron?.length);
const events = dueCronEvents(configured, since, now);
console.log(`${events.length} cron job(s) due between ${since.toISOString()} and ${now.toISOString()}`);
if (!events.length) process.exit(0);

const require = createRequire(join(process.cwd(), "package.json"));
const plugins = [];
for (const p of configured) {
	const mod = await import(pathToFileURL(require.resolve(p.module)).href);
	plugins.push({ plugin: { id: p.id, version: p.version }, definition: mod.default ?? mod, settings: p.settings });
}
const results = await runHooks({ plugins, events, site: config.site });
const failed = results.filter((r) => !r.ok).length;
console.log(`ran ${results.length} cron call(s), ${failed} failed`);
process.exitCode = failed ? 1 : 0;
