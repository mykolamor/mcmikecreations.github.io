import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoPaths } from '../server/paths';
import { parseFactsLibrary, readFactsLibraryFile, serializeFactsLibrary, writeFactsLibrary } from './facts-library-file';

const REAL = fileURLToPath(new URL('../../../static/_projects/data-viz/hikes/facts-library.json', import.meta.url));

const CANONICAL = `{
	"stops": {
		"node/9": {
			"kind": "alpine-hut",
			"note": "Bergsteigeressen",
			"checked": "2026-06-01"
		},
		"node/12806819227": {
			"kind": "cafe"
		},
		"way/3": {
			"kind": "shop"
		}
	},
	"transport": {
		"rb60-munich-ehrwald": {
			"mode": "train",
			"from": {
				"en": "Munich",
				"de": "München"
			},
			"to": {
				"name": "Ehrwald",
				"at": {
					"lat": 47.4,
					"lon": 10.9,
					"name": "Bahnhof",
					"demEle": 994.5
				}
			},
			"price": [
				{
					"amount": 29,
					"currency": "EUR",
					"per": "person"
				}
			],
			"url": {
				"url": "https://bahn.example",
				"label": "DB"
			},
			"checked": "2026-07-01"
		}
	},
	"lifts": {
		"zugspitzbahn": {
			"name": "Zugspitzbahn",
			"kind": "cable-car",
			"from": {
				"ref": "node/1",
				"name": "Talstation"
			},
			"open": {
				"from": "05",
				"to": "10-31"
			}
		}
	},
	"parking": {},
	"tickets": {}
}
`;

test('the library writer is byte-stable and round-trips', () => {
	assert.equal(serializeFactsLibrary(parseFactsLibrary(CANONICAL)), CANONICAL);
	// Kinds, ids and fields in their order however they come in; missing kinds written empty.
	const scrambled = parseFactsLibrary(CANONICAL);
	const shuffled = {
		tickets: {},
		lifts: { zugspitzbahn: { open: { to: '10-31', from: '05' }, from: { name: 'Talstation', ref: 'node/1' }, kind: 'cable-car', name: 'Zugspitzbahn' } },
		transport: {
			'rb60-munich-ehrwald': {
				checked: '2026-07-01', url: { label: 'DB', url: 'https://bahn.example' },
				price: [{ per: 'person', currency: 'EUR', amount: 29 }],
				to: { at: { demEle: 994.5, name: 'Bahnhof', lon: 10.9, lat: 47.4 }, name: 'Ehrwald' },
				from: { de: 'München', en: 'Munich' }, mode: 'train'
			}
		},
		stops: { 'way/3': scrambled.stops['way/3'], 'node/12806819227': scrambled.stops['node/12806819227'], 'node/9': { checked: '2026-06-01', note: 'Bergsteigeressen', kind: 'alpine-hut' } }
	};
	assert.equal(serializeFactsLibrary(shuffled as never), CANONICAL);
	assert.equal(serializeFactsLibrary(parseFactsLibrary('{}')), '{\n\t"stops": {},\n\t"transport": {},\n\t"lifts": {},\n\t"parking": {},\n\t"tickets": {}\n}\n');
	// The file in the repo is canonical, and writing goes to it atomically.
	assert.equal(serializeFactsLibrary(parseFactsLibrary(readFileSync(REAL, 'utf8'))), readFileSync(REAL, 'utf8'));
	const root = mkdtempSync(join(tmpdir(), 'crm-facts-library-'));
	mkdirSync(dirname(repoPaths(root).factsLibrary), { recursive: true });
	writeFactsLibrary(root, parseFactsLibrary(CANONICAL));
	assert.equal(readFileSync(repoPaths(root).factsLibrary, 'utf8'), CANONICAL);
	assert.deepEqual(readFactsLibraryFile(root), parseFactsLibrary(CANONICAL));
	// A malformed file fails as the build does.
	assert.throws(() => parseFactsLibrary('{"lifts": {"x": {"kind": "gondola"}}}'), /facts-library\.json: lifts\.x\.name: required/);
});
