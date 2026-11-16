// Serves the CMS's media URLs for the studio page: a pending upload comes from the page, anything else from the site's static copy.
const PREFIX = "/_emdash/api/media/file/";
const siteBase = new URL(self.registration.scope).pathname.replace(/\/studio\/$/, "");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function pendingFile(clientId, key) {
	const client = clientId ? await self.clients.get(clientId) : null;
	if (!client) return null;
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(resolve, 1500, null);
		channel.port1.onmessage = (e) => {
			clearTimeout(timer);
			// oxlint-disable-next-line promise/no-multiple-resolved -- whichever of the timeout and the reply comes first wins
			resolve(e.data);
		};
		client.postMessage({ type: "studio-media", key }, [channel.port2]);
	});
}

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;
	const key = decodeURIComponent(url.pathname.slice(PREFIX.length));
	event.respondWith(
		(async () => {
			const file = await pendingFile(event.clientId, key);
			if (file) return new Response(file.bytes, { headers: { "content-type": file.contentType } });
			return fetch(`${siteBase}/media/${key.split("/").map(encodeURIComponent).join("/")}`);
		})(),
	);
});
