// Plugin cron for the build Action: which configured jobs fall due in a time window.
// Schedules are 5-field cron expressions in UTC (minute hour day-of-month month day-of-week) or @hourly / @daily / @weekly.

const RE_1 = /\s+/;

const ALIASES = { "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@weekly": "0 0 * * 0" };
const RANGES = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 6],
];

function field(text, [lo, hi]) {
	const out = new Set();
	for (const part of text.split(",")) {
		const [range, step] = part.split("/");
		const n = step === undefined ? 1 : Number(step);
		if (!Number.isInteger(n) || n < 1) throw new Error(`bad step in "${text}"`);
		let a = lo,
			b = hi;
		if (range !== "*") {
			const [x, y] = range.split("-").map(Number);
			if (!Number.isInteger(x) || (y !== undefined && !Number.isInteger(y)))
				throw new Error(`bad field "${text}"`);
			a = x;
			b = y ?? (step === undefined ? x : hi);
		}
		if (a < lo || b > hi || a > b) throw new Error(`"${text}" is outside ${lo}-${hi}`);
		for (let v = a; v <= b; v += n) out.add(v);
	}
	return out;
}

export function parseSchedule(expr) {
	const parts = (ALIASES[expr] ?? expr).trim().split(RE_1);
	if (parts.length !== 5) throw new Error(`cron schedule "${expr}" needs 5 fields`);
	const sets = parts.map((p, i) => field(p, RANGES[i]));
	if (sets[4].has(7)) sets[4].add(0);
	return {
		minutes: sets[0],
		hours: sets[1],
		days: sets[2],
		months: sets[3],
		weekdays: sets[4],
		anyDay: parts[2] === "*",
		anyWeekday: parts[4] === "*",
	};
}

function matches(s, d) {
	if (
		!s.minutes.has(d.getUTCMinutes()) ||
		!s.hours.has(d.getUTCHours()) ||
		!s.months.has(d.getUTCMonth() + 1)
	)
		return false;
	const dom = s.days.has(d.getUTCDate());
	const dow = s.weekdays.has(d.getUTCDay());
	return s.anyDay || s.anyWeekday ? dom && dow : dom || dow;
}

/** Every time the schedule fires in (since, now], at minute resolution, oldest first. */
export function firesBetween(expr, since, now) {
	const s = parseSchedule(expr);
	const out = [];
	const start = Math.floor(since.getTime() / 60000) + 1;
	const end = Math.floor(now.getTime() / 60000);
	for (let m = start; m <= end && out.length < 1000; m++) {
		const d = new Date(m * 60000);
		if (matches(s, d)) out.push(d.toISOString());
	}
	return out;
}

/** Cron events for the configured jobs. A job that fired several times in the window runs once, for its latest time. */
export function dueCronEvents(plugins, since, now) {
	const events = [];
	for (const p of plugins) {
		for (const job of p.cron ?? []) {
			const times = firesBetween(job.schedule, since, now);
			if (times.length)
				events.push({
					plugin: p.id,
					hook: "cron",
					event: {
						name: job.name,
						...(job.data ? { data: job.data } : {}),
						scheduledAt: times.at(-1),
					},
				});
		}
	}
	return events;
}
