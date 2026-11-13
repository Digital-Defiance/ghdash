// Browser shim: one admin user, one tab, so a single ambient store is enough.
export class AsyncLocalStorage {
	#store;
	getStore() { return this.#store; }
	run(store, fn, ...args) { const prev = this.#store; this.#store = store; try { return fn(...args); } finally { this.#store = prev; } }
	enterWith(store) { this.#store = store; }
}
export default { AsyncLocalStorage };
