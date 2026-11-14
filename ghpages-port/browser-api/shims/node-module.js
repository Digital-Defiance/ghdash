// Bundled CJS dependencies call require("crypto"|"util"|"stream") at load time; none of those
// code paths run in the browser, so hand back inert stand-ins instead of failing the chunk.
const stubs = {
	crypto: new Proxy({ webcrypto: globalThis.crypto, randomFillSync: (b) => globalThis.crypto.getRandomValues(b) }, {
		get: (t, k) => (k === "__esModule" ? false : k in t ? t[k] : () => ({})),
	}),
	util: { inherits() {}, promisify: (f) => f, TextEncoder, TextDecoder, inspect: String, deprecate: (f) => f },
	stream: { Stream: class Stream {} },
};
export function createRequire() {
	const req = (id) => stubs[id.replace(/^node:/, "")] ?? {};
	req.resolve = (id) => id;
	return req;
}
