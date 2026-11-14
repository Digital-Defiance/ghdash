import assert from "node:assert/strict";
import { test } from "node:test";

import { dueCronEvents, firesBetween } from "./cron.mjs";
import { runHooks } from "./hooks-runner.mjs";

const at = (s) => new Date(s);

test("schedules fire at the right minutes", () => {
	assert.deepEqual(
		firesBetween("@hourly", at("2026-11-14T10:05:00Z"), at("2026-11-14T12:00:00Z")),
		["2026-11-14T11:00:00.000Z", "2026-11-14T12:00:00.000Z"],
	);
	assert.deepEqual(
		firesBetween("30 9 * * *", at("2026-11-14T00:00:00Z"), at("2026-11-15T00:00:00Z")),
		["2026-11-14T09:30:00.000Z"],
	);
	assert.deepEqual(
		firesBetween("*/20 8 * * *", at("2026-11-14T07:59:00Z"), at("2026-11-14T09:00:00Z")),
		["2026-11-14T08:00:00.000Z", "2026-11-14T08:20:00.000Z", "2026-11-14T08:40:00.000Z"],
	);
	assert.deepEqual(
		firesBetween("0 12 * * 1-5", at("2026-11-13T00:00:00Z"), at("2026-11-16T23:59:00Z")),
		["2026-11-13T12:00:00.000Z", "2026-11-16T12:00:00.000Z"],
	);
	assert.deepEqual(
		firesBetween("@hourly", at("2026-11-14T10:00:00Z"), at("2026-11-14T10:00:00Z")),
		[],
	);
	assert.throws(() =>
		firesBetween("61 * * * *", at("2026-11-14T00:00:00Z"), at("2026-11-14T01:00:00Z")),
	);
	assert.throws(() =>
		firesBetween("* * *", at("2026-11-14T00:00:00Z"), at("2026-11-14T01:00:00Z")),
	);
});

test("only due jobs run, once each, and only for the plugin that owns them", async () => {
	const plugins = [
		{
			id: "a",
			cron: [
				{ name: "digest", schedule: "0 9 * * *", data: { n: 1 } },
				{ name: "late", schedule: "0 23 * * *" },
			],
		},
		{ id: "b", cron: [{ name: "tick", schedule: "@hourly" }] },
	];
	const events = dueCronEvents(plugins, at("2026-11-14T08:00:00Z"), at("2026-11-14T10:30:00Z"));
	assert.deepEqual(
		events.map((e) => [e.plugin, e.event.name, e.event.scheduledAt]),
		[
			["a", "digest", "2026-11-14T09:00:00.000Z"],
			["b", "tick", "2026-11-14T10:00:00.000Z"],
		],
	);
	assert.deepEqual(events[0].event.data, { n: 1 });
	const seen = [];
	const mk = (id) => ({
		plugin: { id },
		definition: { hooks: { cron: async (e, ctx) => seen.push([id, e.name, ctx.plugin.id]) } },
		settings: {},
	});
	const results = await runHooks({ plugins: [mk("a"), mk("b")], events });
	assert.deepEqual(seen, [
		["a", "digest", "a"],
		["b", "tick", "b"],
	]);
	assert.ok(results.every((r) => r.ok));
});
