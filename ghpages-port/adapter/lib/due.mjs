#!/usr/bin/env node
// Prints "true" when content/ holds a scheduled entry whose time has passed, "false" otherwise, so a
// scheduled workflow can skip the build. Reads the JSON only. Usage: due [contentDir]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function isDue(contentDir, now = new Date()) {
	if (!existsSync(contentDir)) return false;
	for (const dir of readdirSync(contentDir).filter((n) => n.startsWith("ec_"))) {
		const full = join(contentDir, dir);
		for (const f of readdirSync(full)) {
			const row = JSON.parse(readFileSync(join(full, f), "utf8"));
			if (row.scheduled_at && !row.deleted_at && new Date(row.scheduled_at) <= now) return true;
		}
	}
	return false;
}

if (process.argv[1] === new URL(import.meta.url).pathname) console.log(String(isDue(process.argv[2] ?? "content")));
