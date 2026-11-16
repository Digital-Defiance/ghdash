const STATE_KEY = "gitdash-oauth";
const b64url = (bytes) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
const randomString = (random, n = 32) => b64url(random(new Uint8Array(n)));

export async function pkceChallenge(verifier, subtle = globalThis.crypto.subtle) {
	return b64url(new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/**
 * Starts a sign-in: remembers a one-time state and PKCE verifier for this tab and returns the address to send the browser to.
 * GitHub by default; GitLab passes its own `authorizeUrl` (`<gitlab>/oauth/authorize`) and `scope: "api"`.
 */
export async function startSignIn({
	clientId,
	redirectUri,
	storage,
	authorizeUrl = "https://github.com/login/oauth/authorize",
	scope,
	random = (a) => globalThis.crypto.getRandomValues(a),
	subtle,
}) {
	const state = randomString(random);
	const verifier = randomString(random, 48);
	storage.setItem(STATE_KEY, JSON.stringify({ state, verifier }));
	const url = new URL(authorizeUrl);
	url.search = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		...(scope ? { response_type: "code", scope } : {}),
		state,
		code_challenge: await pkceChallenge(verifier, subtle),
		code_challenge_method: "S256",
	}).toString();
	return url.href;
}

/**
 * Finishes a sign-in when the page was opened by the host's redirect. Returns the token, or null when the address is not a redirect
 * from us. Throws when the host reported an error, the state does not match, or the exchange refuses.
 * GitHub's token endpoint doesn't allow browser requests, so GitHub goes through `exchangeUrl` (the Worker). GitLab's does,
 * so GitLab passes `tokenUrl` (`<gitlab>/oauth/token`) and `clientId` and needs no secret.
 */
export async function finishSignIn({
	exchangeUrl,
	tokenUrl,
	clientId,
	label = "GitHub",
	redirectUri,
	storage,
	search,
	fetchImpl = globalThis.fetch.bind(globalThis),
}) {
	const params = new URLSearchParams(search);
	const code = params.get("code");
	const error = params.get("error");
	if (!code && !error) return null;
	const saved = (() => {
		try {
			return JSON.parse(storage.getItem(STATE_KEY) ?? "null");
		} catch {
			return null;
		}
	})();
	storage.removeItem(STATE_KEY);
	if (error)
		throw new Error(params.get("error_description") || `${label} did not allow the sign-in.`);
	if (!saved || saved.state !== params.get("state"))
		throw new Error("The sign-in did not start in this tab. Please try again.");
	const res = tokenUrl
		? await fetchImpl(tokenUrl, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: clientId,
					code,
					grant_type: "authorization_code",
					redirect_uri: redirectUri,
					code_verifier: saved.verifier,
				}).toString(),
			})
		: await fetchImpl(exchangeUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code, code_verifier: saved.verifier, redirect_uri: redirectUri }),
			});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token)
		throw new Error(
			body.error_description || body.error || "The sign-in service did not return a token.",
		);
	return body.access_token;
}
