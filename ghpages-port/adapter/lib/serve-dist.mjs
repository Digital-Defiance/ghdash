// Serves dist/client under the site's base path, like GitHub Pages does (404.html for unknown paths).
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const base = (process.env.BASE_PATH ?? "").replace(/\/$/, "");
const root = "dist/client";
const port = Number(process.env.PORT || 4400);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".xml": "application/xml", ".db": "application/octet-stream", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg" };

createServer((req, res) => {
	const url = new URL(req.url, "http://x");
	if (!url.pathname.startsWith(base)) { res.writeHead(404).end("outside base path"); return; }
	let p = normalize(join(root, decodeURIComponent(url.pathname.slice(base.length)))).replace(/\/$/, "");
	if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
	if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
	if (!existsSync(p)) {
		const nf = join(root, "404.html");
		res.writeHead(404, { "content-type": "text/html" }).end(existsSync(nf) ? readFileSync(nf) : "not found");
		return;
	}
	res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }).end(readFileSync(p));
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}${base}/`));
