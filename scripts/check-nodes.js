import { loadHikes } from './load-hikes.js';

const hikesData = loadHikes();

const uniqueNodesMap = new Map();

hikesData.forEach(hike => {
    if (hike.properties?.nodes) {
        hike.properties.nodes.forEach(node => {
            uniqueNodesMap.set(node.id, node);
        });
    }
});

const nodes = Array.from(uniqueNodesMap.values());

const latLonSet = new Map();
const nameSet = new Map();
const wikidataSet = new Map();

/** Remember `node` under `key`, or warn if another node already claimed it. */
function warnDup(map, key, node, label) {
    if (map.has(key)) {
        console.warn(`Duplicate ${label}:`, key, 'for ids:', node.id, map.get(key).id);
    } else {
        map.set(key, node);
    }
}

for (const node of nodes) {
    warnDup(latLonSet, `${node.lat},${node.lon}`, node, 'lat/lon');
    if (node.tags?.name) warnDup(nameSet, node.tags.name, node, 'name');
    if (node.tags?.wikidata) warnDup(wikidataSet, node.tags.wikidata, node, 'wikidata');
}

console.log('Finished checking nodes.');

