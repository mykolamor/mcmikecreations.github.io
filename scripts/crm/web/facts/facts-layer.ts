// The facts' marks on the preview's map, drawn as the site's 2D map draws them (src/lib/hikes/map-2d.ts) with the site's
// own pin icons and popups: hazard stretches over the route, bailout routes dashed on a white casing, pins on top. The
// preview has no POI markers, so every pin stands on its own, and the bailout routes aren't pushed beside the route.
import L from 'leaflet';
import { FACTS_PIN_H, FACTS_PIN_POINTER, factsPinIconHtml, factsPinWidth, pinPopupHtml, pinText, type FactsMarks } from '$lib/hikes/facts-overlay';

export function factsLayer(marks: FactsMarks): L.LayerGroup {
	const layer = L.layerGroup();
	for (const line of marks.lines) {
		L.polyline(line.coords, { color: line.color, weight: 7, opacity: 0.55, lineCap: 'butt' }).bindTooltip(line.title, { sticky: true }).addTo(layer);
	}
	for (const route of marks.routes) {
		L.polyline(route.coords, { color: '#ffffff', weight: 5, opacity: 0.85, interactive: false }).addTo(layer);
		L.polyline(route.coords, { color: route.color, weight: 3, opacity: 1, dashArray: '7 6' }).bindTooltip(route.title, { sticky: true }).addTo(layer);
	}
	for (const pin of marks.pins) {
		const width = factsPinWidth(pin);
		const icon = L.divIcon({
			html: factsPinIconHtml(pin, width),
			className: '',
			iconSize: [width, FACTS_PIN_H + FACTS_PIN_POINTER],
			iconAnchor: [width / 2, FACTS_PIN_H + FACTS_PIN_POINTER],
			popupAnchor: [0, -(FACTS_PIN_H + FACTS_PIN_POINTER)]
		});
		L.marker([pin.lat, pin.lon], { icon, title: pinText(pin), alt: pin.name, riseOnHover: true, zIndexOffset: 500 }).bindPopup(pinPopupHtml(pin, 'en')).addTo(layer);
	}
	return layer;
}
