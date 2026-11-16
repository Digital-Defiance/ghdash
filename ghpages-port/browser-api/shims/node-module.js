// Bundled CJS dependencies call require("crypto"|"util"|"stream") at load time; none of those
// code paths run in the browser, so hand back inert stand-ins instead of failing the chunk.

const RE_1 = /^node:/;

const stubs = {
	crypto: new Proxy(
		{ webcrypto: globalThis.crypto, randomFillSync: (b) => globalThis.crypto.getRandomValues(b) },
		{
			get: (t, k) => (k === "__esModule" ? false : k in t ? t[k] : () => ({})),
		},
	),
	util: {
		inherits() {},
		promisify: (f) => f,
		TextEncoder,
		TextDecoder,
		inspect: String,
		deprecate: (f) => f,
	},
	// oxlint-disable-next-line typescript/no-extraneous-class -- stands in for a class that dependencies only reference
	stream: { Stream: class Stream {} },
};
export function createRequire() {
	const req = (id) => stubs[id.replace(RE_1, "")] ?? {};
	req.resolve = (id) => id;
	return req;
}
