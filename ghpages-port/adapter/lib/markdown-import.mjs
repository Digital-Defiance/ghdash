// Reads a Jekyll site or a folder of Markdown files and works out the entries to create. No database involved.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "_site", "_includes", "_layouts", "_sass", "_data", "vendor", ".jekyll-cache", "assets", "media"]);
const SKIP_FILES = /^(readme|license|changelog|contributing|code_of_conduct)(\.|$)/i;
const DATED = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

function scalar(text) {
	const t = text.trim();
	if (t === "" || t === "~" || t === "null") return "";
	if (t === "true") return true;
	if (t === "false") return false;
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
	return t;
}

/** The common subset of YAML front matter: `key: value`, quoted values, `[a, b]` and `- item` lists. */
export function parseFrontMatter(source) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
	if (!m) return { data: {}, body: source };
	const data = {};
	let key = null;
	for (const line of m[1].split(/\r?\n/)) {
		if (/^\s*(#|$)/.test(line)) continue;
		const item = /^\s+-\s+(.*)$/.exec(line) ?? (key && Array.isArray(data[key]) ? /^-\s+(.*)$/.exec(line) : null);
		if (item && key) {
			if (!Array.isArray(data[key])) data[key] = [];
			data[key].push(scalar(item[1]));
			continue;
		}
		const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!kv) continue;
		key = kv[1];
		const v = kv[2].trim();
		if (v === "") data[key] = [];
		else if (v.startsWith("[") && v.endsWith("]")) data[key] = v.slice(1, -1).split(",").map(scalar).filter((x) => x !== "");
		else data[key] = scalar(v);
	}
	for (const k of Object.keys(data)) if (Array.isArray(data[k]) && data[k].length === 0) data[k] = "";
	return { data, body: source.slice(m[0].length) };
}

export const slugify = (s) =>
	String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const humanize = (slug) => slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

function list(value) {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === "string" && value) return value.split(/[,\s]+/);
	return [];
}

function walk(dir, root = dir) {
	const out = [];
	for (const name of readdirSync(dir).sort()) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			if (!SKIP_DIRS.has(name)) out.push(...walk(p, root));
		} else if (/\.(md|markdown)$/i.test(name) && !SKIP_FILES.test(name)) out.push(p);
	}
	return out;
}

/** Turns Jekyll's simplest Liquid into plain Markdown and counts what is left over. */
export function cleanLiquid(text) {
	let left = 0;
	const out = text
		.replace(/\{\{\s*["']([^"']+)["']\s*\|\s*(?:relative_url|absolute_url)\s*\}\}/g, "$1")
		.replace(/\{\{\s*site\.baseurl\s*\}\}/g, "")
		.replace(/\{%\s*raw\s*%\}|\{%\s*endraw\s*%\}/g, "")
		.replace(/\{%\s*highlight\s+(\w+)[^%]*%\}([\s\S]*?)\{%\s*endhighlight\s*%\}/g, "```$1\n$2\n```")
		.replace(/(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g, () => { left++; return ""; });
	return { text: out, unsupported: left };
}

const IMAGE = /(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g;

/**
 * Finds the entries in `dir`. Files under `_posts` or named `YYYY-MM-DD-name` become posts (`_drafts` as drafts),
 * everything else becomes a page. `siteRoot` is where root-relative image paths such as /assets/a.png are looked up.
 */
export function planEntries(dir, { siteRoot = dir, postCollection = "posts", pageCollection = "pages" } = {}) {
	const entries = [];
	const warnings = [];
	const used = new Set();
	for (const file of walk(dir)) {
		const rel = relative(dir, file).split(sep);
		const name = basename(file, extname(file));
		const { data, body: rawBody } = parseFrontMatter(readFileSync(file, "utf8"));
		const dated = DATED.exec(name);
		const isDraftDir = rel.includes("_drafts");
		const isPost = rel.includes("_posts") || isDraftDir || !!dated;
		const collection = isPost ? postCollection : pageCollection;
		const base = isPost ? (dated ? dated[2] : name) : rel.slice(0, -1).concat(name === "index" ? [] : name).join("-") || "home";
		let slug = slugify(data.slug || base) || "untitled";
		for (let n = 2; used.has(`${collection}/${slug}`); n++) slug = `${slugify(data.slug || base)}-${n}`;
		used.add(`${collection}/${slug}`);

		const cleaned = cleanLiquid(rawBody);
		if (cleaned.unsupported) warnings.push(`${relative(dir, file)}: ${cleaned.unsupported} Liquid tag(s) removed`);
		let body = cleaned.text.replace(/^\s+/, "");
		let title = data.title ? String(data.title) : "";
		const h1 = /^# +(.+)\r?\n/.exec(body);
		if (!title && h1) {
			title = h1[1].trim();
			body = body.slice(h1[0].length);
		}
		if (!title) title = humanize(slug);

		const images = [];
		body = body.replace(IMAGE, (m, pre, url, post) => {
			if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url) || url.startsWith("data:")) return m;
			const clean = decodeURIComponent(url.split(/[?#]/)[0]);
			const candidates = clean.startsWith("/") ? [join(siteRoot, clean)] : [join(file, "..", clean), join(siteRoot, clean)];
			const found = candidates.find((c) => existsSync(c) && statSync(c).isFile());
			if (!found) {
				warnings.push(`${relative(dir, file)}: image not found: ${url}`);
				return m;
			}
			images.push(found);
			return `${pre}\u0000IMG${images.length - 1}\u0000${post}`;
		});

		const date = data.date ? String(data.date) : dated ? dated[1] : "";
		const parsed = date ? new Date(date.replace(/ ([+-]\d{2})(\d{2})$/, " $1:$2")) : null;
		entries.push({
			file: relative(dir, file),
			collection,
			slug,
			title,
			body,
			images,
			status: data.published === false || isDraftDir ? "draft" : "published",
			publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
			tags: isPost ? list(data.tags) : [],
			categories: isPost ? list(data.categories ?? data.category) : [],
			excerpt: isPost && (data.excerpt || data.description) ? String(data.excerpt || data.description) : "",
		});
	}
	return { entries, warnings };
}
