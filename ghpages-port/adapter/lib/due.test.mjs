import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { isDue } from "./due.mjs";

const site = (rows) => {
	const dir = mkdtempSync(join(tmpdir(), "due-"));
	mkdirSync(join(dir, "ec_posts"));
	rows.forEach((r, i) => writeFileSync(join(dir, "ec_posts", `${i}.json`), JSON.stringify(r)));
	return dir;
};
const now = new Date("2026-06-01T00:00:00Z");

test("a scheduled entry in the past is due", () => {
	assert.equal(isDue(site([{ scheduled_at: "2026-05-31T00:00:00Z" }]), now), true);
});

test("future, unscheduled and trashed entries are not due", () => {
	assert.equal(isDue(site([{ scheduled_at: "2026-07-01T00:00:00Z" }, { scheduled_at: null }, { scheduled_at: "2026-05-01T00:00:00Z", deleted_at: "2026-05-02T00:00:00Z" }]), now), false);
});

test("a missing content directory is not due", () => {
	assert.equal(isDue(join(tmpdir(), "nope-" + Date.now()), now), false);
});
