// mapy.com serves tiles from a CloudFront distribution guarded by signed cookies.
// The browser obtains them by (1) loading the site to get a `User-Id` session cookie,
// then (2) calling `/refreshCookies`, which returns the CloudFront-* cookies (valid ~1h).
// We replicate that handshake so no manual cookie copying is needed. The result is
// cached and transparently refreshed shortly before it expires.
export const mapyUserAgent = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";


let mapyCookie = null;
let mapyCookieExpiry = 0;

const parseSetCookies = (setCookies, jar) => {
	for (const header of setCookies) {
		const pair = header.split(';', 1)[0];
		const eq = pair.indexOf('=');
		if (eq < 0) continue;
		jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
	}
};

let inFlight = null;

// Concurrent callers (a map load asks for ~20 tiles at once) share one handshake.
export const getMapyCookie = async () => {
	const now = Math.floor(Date.now() / 1000);
	// Refresh a bit early (5 min) so long download runs never hit an expired cookie.
	if (mapyCookie && now < mapyCookieExpiry - 300) return mapyCookie;
	inFlight ??= handshake(now).finally(() => {
		inFlight = null;
	});
	return inFlight;
};

const handshake = async (now) => {

	const jar = {};

	// 1. Bootstrap a session to receive the `User-Id` cookie.
	const home = await fetch("https://mapy.com/en/", {
		headers: { "User-Agent": mapyUserAgent },
	});
	if (!home.ok) {
		throw new Error(`mapy.com session bootstrap failed: ${home.status} ${home.statusText}`);
	}
	parseSetCookies(home.headers.getSetCookie(), jar);

	// 2. Exchange the session for CloudFront signed cookies.
	const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
	const refresh = await fetch("https://mapy.com/refreshCookies", {
		headers: {
			"User-Agent": mapyUserAgent,
			"Cookie": cookieHeader,
			"Referer": "https://mapy.com/en/turisticka",
		},
	});
	if (!refresh.ok) {
		throw new Error(`mapy.com refreshCookies failed: ${refresh.status} ${refresh.statusText}`);
	}
	const data = await refresh.json();
	for (const { cname, value } of data.cookies ?? []) {
		jar[cname] = value;
	}

	mapyCookieExpiry = data.expiration ?? (now + (data.lifetime ?? 3600));
	mapyCookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
	console.log(`Fetched mapy.com cookies (valid until ${new Date(mapyCookieExpiry * 1000).toLocaleString('en-US', { timeZone: 'CET' })}).`);
	return mapyCookie;
};
