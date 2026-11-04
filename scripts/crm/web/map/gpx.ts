/** `[lat, lon, ele?]` of a GPX text: every trkpt, else every rtept. Regex-based so it also runs under node. */
export function parseGpx(xml: string): [number, number, number?][] {
	const read = (tag: string): [number, number, number?][] => {
		const out: [number, number, number?][] = [];
		const re = new RegExp(`<${tag}\\b([^>]*?)(/>|>([\\s\\S]*?)</${tag}>)`, 'g');
		for (const m of xml.matchAll(re)) {
			const lat = /\blat\s*=\s*["']([^"']+)["']/.exec(m[1]);
			const lon = /\blon\s*=\s*["']([^"']+)["']/.exec(m[1]);
			if (!lat || !lon || !Number.isFinite(+lat[1]) || !Number.isFinite(+lon[1])) continue;
			const ele = m[3] === undefined ? null : /<ele>\s*([^<\s]+)\s*<\/ele>/.exec(m[3]);
			out.push(ele && Number.isFinite(+ele[1]) ? [+lat[1], +lon[1], +ele[1]] : [+lat[1], +lon[1]]);
		}
		return out;
	};
	const trk = read('trkpt');
	return trk.length ? trk : read('rtept');
}
