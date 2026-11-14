// ghdash-pages run-hooks --base <sha> --head <sha>
// Runs the after-hooks of the plugins listed in hooks.config.json for content that changed between the two commits.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { eventsBetween, runHooks } from "./hooks-runner.mjs";

const arg = (name, env) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : process.env[env];
};
const base = arg("base", "HOOKS_BASE");
const head = arg("head", "HOOKS_HEAD") || "HEAD";
const configPath = "hooks.config.json";

if (!existsSync(configPath)) {
	console.log("no hooks.config.json, nothing to run");
	process.exit(0);
}
if (!base || /^0+$/.test(base)) {
	console.log("no base commit (first push or manual run), nothing to run");
	process.exit(0);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const require = createRequire(join(process.cwd(), "package.json"));
const plugins = [];
for (const p of config.plugins ?? []) {
	const mod = await import(pathToFileURL(require.resolve(p.module)).href);
	plugins.push({ plugin: { id: p.id, version: p.version }, definition: mod.default ?? mod, settings: p.settings });
}

const events = eventsBetween(base, head);
console.log(`${events.length} content change(s) between ${base.slice(0, 7)} and ${head.slice(0, 7)}`);
if (!events.length || !plugins.length) process.exit(0);
const results = await runHooks({ plugins, events, site: config.site });
const failed = results.filter((r) => !r.ok).length;
console.log(`ran ${results.length} hook call(s), ${failed} failed`);
process.exitCode = failed ? 1 : 0;
