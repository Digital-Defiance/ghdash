/**
 * Token exchange for "Sign in with GitHub" in the studio, for a Cloudflare Worker. GitHub's token endpoint needs the app's client
 * secret and does not allow browser requests, so this small service trades the one-time code for a token and hands it to the studio.
 * It stores nothing and logs nothing.
 *
 * Variables: ALLOWED_ORIGIN (your site's origin, for example https://you.github.io), GITHUB_CLIENT_ID.
 * Secret: GITHUB_CLIENT_SECRET.
 */

const json = (body, status, origin) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "access-control-allow-origin": origin, "cache-control": "no-store", vary: "origin" },
	});

export async function handleExchange(request, env, fetchImpl = fetch) {
	const origin = env.ALLOWED_ORIGIN;
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" },
		});
	}
	if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
	if (request.headers.get("origin") !== origin) return json({ error: "Origin not allowed" }, 403, origin);

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Could not read the request" }, 400, origin);
	}
	const { code, code_verifier: verifier, redirect_uri: redirectUri } = body ?? {};
	if (typeof code !== "string" || typeof verifier !== "string" || typeof redirectUri !== "string" || !code || !verifier) return json({ error: "Missing code" }, 400, origin);
	if (!redirectUri.startsWith(`${origin}/`)) return json({ error: "Redirect address not allowed" }, 400, origin);

	const res = await fetchImpl("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, code_verifier: verifier, redirect_uri: redirectUri }),
	});
	const token = await res.json().catch(() => ({}));
	if (!res.ok || !token.access_token) return json({ error: token.error_description || "GitHub did not accept the sign-in" }, 400, origin);
	return json({ access_token: token.access_token, expires_in: token.expires_in ?? null }, 200, origin);
}

export default { fetch: (request, env) => handleExchange(request, env) };
