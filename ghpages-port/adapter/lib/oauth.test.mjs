import assert from "node:assert/strict";
import { test } from "node:test";

import { finishSignIn, pkceChallenge, startSignIn } from "../studio/oauth.js";
import { handleExchange } from "../worker/github-oauth.mjs";

const memory = () => {
	const m = new Map();
	return {
		getItem: (k) => m.get(k) ?? null,
		setItem: (k, v) => m.set(k, v),
		removeItem: (k) => m.delete(k),
	};
};
const cfg = { clientId: "Iv1.abc", redirectUri: "https://me.github.io/site/studio/" };

test("the PKCE challenge matches the RFC 7636 example", async () => {
	assert.equal(
		await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
		"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
	);
});

test("starting a sign-in sends the browser to GitHub with a challenge and keeps the secret half in the tab", async () => {
	const storage = memory();
	const url = new URL(await startSignIn({ ...cfg, storage }));
	assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
	assert.equal(url.searchParams.get("client_id"), "Iv1.abc");
	assert.equal(url.searchParams.get("redirect_uri"), cfg.redirectUri);
	assert.equal(url.searchParams.get("code_challenge_method"), "S256");
	const saved = JSON.parse(storage.getItem("ghdash-oauth"));
	assert.equal(url.searchParams.get("state"), saved.state);
	assert.equal(url.searchParams.get("code_challenge"), await pkceChallenge(saved.verifier));
	assert.ok(!url.href.includes(saved.verifier));
});

const exchange = (body, status = 200) => {
	const calls = [];
	return {
		calls,
		impl: async (url, init) => {
			calls.push({ url, body: JSON.parse(init.body) });
			return new Response(JSON.stringify(body), { status });
		},
	};
};

test("a redirect with the right state is traded for a token, once", async () => {
	const storage = memory();
	const url = new URL(await startSignIn({ ...cfg, storage }));
	const state = url.searchParams.get("state");
	const x = exchange({ access_token: "ghu_tok" });
	const opts = {
		exchangeUrl: "https://w.test/exchange",
		redirectUri: cfg.redirectUri,
		storage,
		fetchImpl: x.impl,
	};
	assert.equal(await finishSignIn({ ...opts, search: `?code=abc&state=${state}` }), "ghu_tok");
	assert.equal(x.calls[0].body.code, "abc");
	assert.equal(x.calls[0].body.redirect_uri, cfg.redirectUri);
	await assert.rejects(
		finishSignIn({ ...opts, search: `?code=abc&state=${state}` }),
		/did not start in this tab/,
	);
});

test("an ordinary page load is not a sign-in; a wrong state, a GitHub error and a refusal are errors", async () => {
	const storage = memory();
	const x = exchange({ error: "nope" }, 400);
	const opts = {
		exchangeUrl: "https://w.test/exchange",
		redirectUri: cfg.redirectUri,
		storage,
		fetchImpl: x.impl,
	};
	assert.equal(await finishSignIn({ ...opts, search: "?p=settings" }), null);
	await startSignIn({ ...cfg, storage });
	await assert.rejects(
		finishSignIn({ ...opts, search: "?code=abc&state=forged" }),
		/did not start in this tab/,
	);
	assert.equal(x.calls.length, 0);
	await assert.rejects(
		finishSignIn({ ...opts, search: "?error=access_denied&error_description=Denied" }),
		/Denied/,
	);
	const state = new URL(await startSignIn({ ...cfg, storage })).searchParams.get("state");
	await assert.rejects(finishSignIn({ ...opts, search: `?code=abc&state=${state}` }), /nope/);
});

const env = {
	ALLOWED_ORIGIN: "https://me.github.io",
	GITHUB_CLIENT_ID: "Iv1.abc",
	GITHUB_CLIENT_SECRET: "secret",
};
const post = (body, headers = {}) =>
	new Request("https://w.test/", {
		method: "POST",
		headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
const good = { code: "c1", code_verifier: "v1", redirect_uri: "https://me.github.io/site/studio/" };

test("the worker adds the client secret, asks GitHub and returns only the token", async () => {
	const x = exchange({
		access_token: "ghu_tok",
		expires_in: 28800,
		refresh_token: "ghr_x",
		token_type: "bearer",
	});
	const res = await handleExchange(post(good), env, x.impl);
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { access_token: "ghu_tok", expires_in: 28800 });
	assert.equal(res.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
	assert.deepEqual(x.calls[0].body, {
		client_id: "Iv1.abc",
		client_secret: "secret",
		code: "c1",
		code_verifier: "v1",
		redirect_uri: good.redirect_uri,
	});
});

test("the worker refuses other origins, foreign redirect addresses and incomplete requests without calling GitHub", async () => {
	const x = exchange({ access_token: "t" });
	assert.equal(
		(await handleExchange(post(good, { origin: "https://evil.test" }), env, x.impl)).status,
		403,
	);
	assert.equal(
		(
			await handleExchange(
				post({ ...good, redirect_uri: "https://evil.test/studio/" }),
				env,
				x.impl,
			)
		).status,
		400,
	);
	assert.equal(
		(
			await handleExchange(
				post({ ...good, redirect_uri: "https://me.github.io.evil.test/" }),
				env,
				x.impl,
			)
		).status,
		400,
	);
	assert.equal((await handleExchange(post({ code: "c1" }), env, x.impl)).status, 400);
	assert.equal((await handleExchange(new Request("https://w.test/"), env, x.impl)).status, 405);
	assert.equal(x.calls.length, 0);
});

test("a GitHub refusal becomes a 400 without a token, and preflight answers for the site only", async () => {
	const x = exchange({
		error: "bad_verification_code",
		error_description: "The code passed is incorrect or expired.",
	});
	const res = await handleExchange(post(good), env, x.impl);
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /incorrect or expired/);
	const pre = await handleExchange(new Request("https://w.test/", { method: "OPTIONS" }), env);
	assert.equal(pre.status, 204);
	assert.equal(pre.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
});
