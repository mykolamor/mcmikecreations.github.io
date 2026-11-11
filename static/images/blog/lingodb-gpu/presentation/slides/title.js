// Slide 1: title and authors. One state; the content rises in on entry.
import { slide, h, svg } from '../lib.js';

/**
 * A custom "P" for the kicker, in the text's colour and sized to its cap height: a thick stem with a slight
 * inward curve and a near-circular bowl. viewBox units: cap height 100, baseline at y = 100.
 */
function bigP() {
	const p = svg('svg', { viewBox: '0 0 68 100', role: 'img', 'aria-label': 'P', style: 'display:inline-block;height:0.72em;width:0.49em;vertical-align:baseline;overflow:visible;margin:0 0.04em;' });
	p.append(
		// Stem: about 22 units wide, both edges bowing slightly to the left; it starts at y 18, between the bowl's
		// top (y 2) and centre (y 30). Both ends are semicircular caps (r 11); the bottom cap touches the baseline. The SVG is set inline-block because the site's base CSS makes svg a block.
		svg('path', { d: 'M5,89 C1,68 1,40 7,18 A11,11 0 0,1 29,18 C23,40 23,68 27,89 A11,11 0 0,1 5,89 Z', style: 'fill:currentColor;' }),
		// Bowl: a ring (outer r 28, inner r 12) at the top of the stem.
		svg('path', { d: 'M38,2 a28,28 0 1,1 0,56 a28,28 0 1,1 0,-56 Z M42,18 a12,12 0 1,0 0,24 a12,12 0 1,0 0,-24 Z', style: 'fill:currentColor;fill-rule:evenodd;' })
	);
	return p;
}

export default slide({
	name: 'title',
	label: { en: 'Title', de: 'Titel', uk: 'Титул' },
	states: [{ name: 'title', label: { en: 'Title', de: 'Titel', uk: 'Титул' } }],
	build(b, root) {
		const wrap = h('div', 'position:absolute;left:120px;right:120px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:34px;');
		// The kicker's "P" is drawn (bigP), with the text around it localized on both sides.
		const kicker = h('div', 'font-size:30px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--fig-accent);');
		kicker.append(
			b.text('span', '', { en: 'The Three ', de: 'Die drei ', uk: 'Три «' }),
			bigP(),
			b.text('span', '', { en: '’s of GPU Databases', de: ' der GPU-Datenbanken', uk: '» GPU-баз даних' })
		);
		const title = b.text('h1', 'margin:0;font-size:76px;line-height:1.06;font-weight:800;letter-spacing:-0.02em;', {
			en: 'Practical, Portable, and Performant GPU Query Execution',
			de: 'Praxistaugliche, portable und performante Anfrageausführung auf GPUs',
			uk: 'Практичне, портоване й продуктивне виконання запитів на GPU'
		});
		const rule = h('div', 'width:160px;height:6px;border-radius:3px;background:var(--fig-accent2);');
		const authors = b.text('div', 'font-size:32px;line-height:1.4;white-space:pre-line;', {
			en: '**Mykola Morozov**, Julia Spindler, Lukas Haußmann,\nJana Giceva *(TUM)*, Michael Jungmair *(Aalto)*',
			de: '**Mykola Morozov**, Julia Spindler, Lukas Haußmann,\nJana Giceva *(TUM)*, Michael Jungmair *(Aalto)*',
			uk: '**Микола Морозов**, Julia Spindler, Lukas Haußmann,\nJana Giceva *(TUM)*, Michael Jungmair *(Aalto)*'
		});
		for (const el of [kicker, title, rule, authors]) {
			b.show(el, 0);
			wrap.append(el);
		}
		root.append(wrap);
	}
});
