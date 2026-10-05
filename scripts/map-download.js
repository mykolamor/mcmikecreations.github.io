// noinspection JSUnusedLocalSymbols
import { geoMercator } from 'd3-geo';
import { tile } from 'd3-tile';
// noinspection ES6PreferShortImport
import { loadHikes, resolveHikeForPost } from './load-hikes.js';
import { existsSync, statSync } from 'fs';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { createHash } from 'crypto';
// noinspection ES6PreferShortImport
import { providers, providerFolder, providerFile } from '../src/lib/data/map-providers.js';
// noinspection ES6PreferShortImport
import { getMapFeatures } from '../src/lib/data/map-get-features.js';
// noinspection ES6PreferShortImport
import { hikeSlug } from '../src/lib/data/hikes-core.js';

const maps = loadHikes();

// Load map based on name and mapbox key. E.g. node map-download.js seekarkreuz pk.eya79cwhrfa9we

const mapFolder = `../static/${providerFolder}/maps`;

const verifyFolder = async (path) => {
	if (!existsSync(path)) {
		await mkdir(path, { recursive: true });
	}
}

// Tile servers can refuse a request with a perfectly valid 256x256 PNG that says so in
// words - OSM serves its "403 Access blocked" placeholder with HTTP 200 and
// content-type image/png. Neither the status code nor the signature check below catches those,
// and once written they are indistinguishable from a real tile to `existsSync`, so we match
// them by content hash. Size is checked first to avoid hashing every cached tile.
const rejectedTiles = [
	{ size: 6987, md5: 'c069a15b2cc2d6b6f527ad09eb93c61a', reason: 'OSM "403 Access blocked" placeholder' },
];
const rejectedTileSizes = new Set(rejectedTiles.map((x) => x.size));

// Mapbox answers its `.png` satellite endpoint with JPEG, so accept either signature.
const imageSignatures = [
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG
	Buffer.from([0xff, 0xd8, 0xff]),                               // JPEG
];
const isImage = (/** @type {Buffer} */ buffer) =>
	imageSignatures.some((signature) => buffer.subarray(0, signature.length).equals(signature));

const rejectedTile = (/** @type {Buffer} */ buffer) => {
	if (!rejectedTileSizes.has(buffer.length)) return undefined;
	const md5 = createHash('md5').update(buffer).digest('hex');
	return rejectedTiles.find((x) => x.md5 === md5);
};

const downloadFile = async (address, fileName, requestInit = undefined) => {
	const destination = resolve(mapFolder, fileName);
	if (existsSync(destination)) {
		// Re-fetch tiles a previous run cached before we knew to reject them.
		if (!rejectedTileSizes.has(statSync(destination).size)) return 0;
		const cached = rejectedTile(await readFile(destination));
		if (!cached) return 0;
		console.warn(`Replacing ${fileName}: cached ${cached.reason}.`);
		await unlink(destination);
	}

	// Wait a second between downloads to prevent rate-limiting
	await new Promise(resolve => setTimeout(resolve, 1000));

	//console.log(`Downloading ${address}`);
	const response = await fetch(address, requestInit);

	// OSM flags a refused request with this header even though it answers 200.
	if (response.headers.has('x-blocked')) {
		console.error(`Blocked by ${new URL(address).host}: ${response.headers.get('x-blocked')}`);
		process.exit(1);
	}

	if (response.status === 429) {
		const interval = response.headers.get('X-Rate-Limit-Interval');
		const limit = response.headers.get('X-Rate-Limit-Limit');
		const reset = response.headers.get('X-Rate-Limit-Reset');

		console.error(`Rate Limit Exceeded (429)!`);
		console.error(`Interval: ${interval} seconds`);
		console.error(`Limit: ${limit} requests`);
		if (reset) {
			const resetDate = new Date(parseInt(reset, 10) * 1000); // Unix timestamp is in seconds
			console.error(`Reset: ${resetDate.toLocaleString('en-US', { timeZone: 'CET' })}`);
		}
		
		process.exit(1);
	}

	const buffer = Buffer.from(await response.arrayBuffer());
	if (!response.ok || !isImage(buffer)) {
		const decoder = new TextDecoder("utf-8");
		console.error(`Failed to download ${address}: ${response.status} ${response.statusText}`, decoder.decode(buffer));
		return 0;
	}

	const rejected = rejectedTile(buffer);
	if (rejected) {
		console.error(`Refusing to save ${fileName}: ${new URL(address).host} returned ${rejected.reason}.`);
		process.exit(1);
	}

	await writeFile(destination, buffer);

	return buffer.length;
};

const slug = process.argv.at(2);

// mapy.com serves tiles from a CloudFront distribution guarded by signed cookies.
// The browser obtains them by (1) loading the site to get a `User-Id` session cookie,
// then (2) calling `/refreshCookies`, which returns the CloudFront-* cookies (valid ~1h).
// We replicate that handshake so no manual cookie copying is needed. The result is
// cached and transparently refreshed shortly before it expires.
const mapyUserAgent = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";

// OSM's tile usage policy requires a User-Agent that identifies the application; requests
// sent with a generic library UA (Node's default is `node`) are answered with the
// "403 Access blocked" placeholder image instead of a tile, and the one-second delay above
// keeps us inside the policy's limits. https://operations.osmfoundation.org/policies/tiles/
const osmUserAgent = "ligmapper-tile-prefetch/1.0 (https://github.com/Evenfall-Tech/LigMapper)";
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

const getMapyCookie = async () => {
	const now = Math.floor(Date.now() / 1000);
	// Refresh a bit early (5 min) so long download runs never hit an expired cookie.
	if (mapyCookie && now < mapyCookieExpiry - 300) return mapyCookie;

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
const skuMapboxDEM = process.env.mapboxDEMSKU;
const tokenMapboxDEM = process.env.mapboxDEMAccess;
const skuMapboxSatellite = process.env.mapboxSatelliteSKU;
const tokenMapboxSatellite = process.env.mapboxSatelliteAccess;
const tokenNextzen = process.env.nextzenAccess;
const selected = slug === undefined ? maps : maps.filter((x) => hikeSlug(x.route) === slug);

if (selected.length === 0) {
	console.error(`Failed to fetch /maps/${slug} metadata.`);
}

// The map page renders a hike as-is, but each post page renders it with that
// post's front matter applied, which may move the origin or resize the map.
// Fetch tiles for every distinct origin/height once.
const metas = [];
const seenViews = new Set();
for (const hike of selected) {
	const posts = hike.properties.dates.filter((d) => d.path).map((d) => resolveHikeForPost(hike, d).hike);
	for (const view of [hike, ...posts]) {
		const { lat, lon } = view.standardFeatures.origin;
		const key = `${lat},${lon},${view.height}`;
		if (seenViews.has(key)) continue;
		seenViews.add(key);
		metas.push(view);
	}
}

for (const meta of metas) {
	await downloadMeta(meta);
}

async function downloadMeta(meta) {
	const features = getMapFeatures(meta);
	const origin = features.find((x) => x.type === 'Origin');

	if (!origin) {
		console.error(`Failed to find origin for /maps/${slug}.`);
	}

	const height = meta.height;
	const projection = geoMercator()
		.center([origin.data.lon, origin.data.lat])
		.scale(Math.pow(2, 21) / (2 * Math.PI))
		.translate([height / 2, height / 2]);

	const tileFunc = tile()
		.size([height, height])
		.scale(projection.scale() * 2 * Math.PI)
		.translate(projection([0, 0]));
	const tiles = tileFunc();

	await verifyFolder(resolve(mapFolder, `${providers.mapboxDEM.tileset}/`));
	await verifyFolder(resolve(mapFolder, `${providers.mapboxSatellite.tileset}/`));
	await verifyFolder(resolve(mapFolder, `${providers.nextzenTerrariumDEM.tileset}/`));
	await verifyFolder(resolve(mapFolder, `${providers.osm.tileset}/`));
	await verifyFolder(resolve(mapFolder, `${providers.mapyOutdoor.tileset}/`));

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	for (const [x, y, z] of tiles) {
		//console.log(`Downloading ${z}/${x}/${y}`);
		let url = `${skuMapboxDEM}`.length > 0 ? `sku=${skuMapboxDEM}&access_token=${tokenMapboxDEM}` : `access_token=${tokenMapboxDEM}`;
		await downloadFile(
			providers.mapboxDEM.url(x, y, z, url),
			providerFile(x, y, z, providers.mapboxDEM.tileset, providers.mapboxDEM.format),
			{
				method: 'GET',
				headers: {
					"Origin": providers.mapboxDEM.origin,
					"Referrer": providers.mapboxDEM.origin,
				},
				referrer: providers.mapboxDEM.origin,
			}
		);
		url = `api_key=${tokenNextzen}`;
		await downloadFile(
			providers.nextzenTerrariumDEM.url(x, y, z, `api_key=${tokenNextzen}`),
			providerFile(x, y, z, providers.nextzenTerrariumDEM.tileset, providers.nextzenTerrariumDEM.format),
			undefined
		);
		await downloadFile(
			providers.osm.url(x, y, z),
			providerFile(x, y, z, providers.osm.tileset, providers.osm.format),
			{
				method: 'GET',
				headers: {
					"User-Agent": osmUserAgent,
				},
			}
		);
		url = `${skuMapboxSatellite}`.length > 0 ? `sku=${skuMapboxSatellite}&access_token=${tokenMapboxSatellite}` : `access_token=${tokenMapboxSatellite}`;
		await downloadFile(
			providers.mapboxSatellite.url(x, y, z, `sku=${skuMapboxSatellite}&access_token=${tokenMapboxSatellite}`),
			providerFile(x, y, z, providers.mapboxSatellite.tileset, providers.mapboxSatellite.format),
			{
				method: 'GET',
				headers: {
					"Origin": providers.mapboxDEM.origin,
					"Referrer": providers.mapboxDEM.origin,
				},
				referrer: providers.mapboxDEM.origin,
			}
		);
		await downloadFile(
			providers.mapyOutdoor.url(x, y, z),
			providerFile(x, y, z, providers.mapyOutdoor.tileset, providers.mapyOutdoor.format),
			{
				method: 'GET',
				headers: {
					"Origin": providers.mapyOutdoor.origin,
					"Referrer": providers.mapyOutdoor.origin + '/',
					"Cookie": await getMapyCookie(),
					"Accept": "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5",
					"Priority": "u=5, i",
					"Sec-Fetch-Dest": "image",
					"Sec-Fetch-Mode": "cors",
					"Sec-Fetch-Site": "same-site",
					"Sec-GPC": "1",
					"TE": "trailers"
				},
				referrer: providers.mapyOutdoor.origin + '/',
			}
		);
	}
}
