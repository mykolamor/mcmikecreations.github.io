// Slide 3: a d3 bar chart from inline data. A forward entrance grows the bars from zero; the second
// state dims all but the three main bars and fades in a caption. Colours come from the frame's theme
// and are re-read on update, which recolours and relabels in place without transitions.
import * as d3 from 'd3';

/** @typedef {import('../../../../../../src/lib/presentation/types').SlideContext} SlideContext */
/** @typedef {import('../../../../../../src/lib/presentation/types').SlideDef} SlideDef */
/** @typedef {import('../../../../../../src/lib/presentation/types').StepHandle} StepHandle */

const VALUES = [2, 3, 5, 7, 9, 8, 4, 3];
const MONTHS = {
	en: ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
	de: ['Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt'],
	uk: ['бер', 'квіт', 'трав', 'черв', 'лип', 'серп', 'вер', 'жовт']
};
/** Indices of the highlighted bars (June to August). */
const MAIN = new Set([3, 4, 5]);
const TEXT = {
	title: { en: 'Hikes per month', de: 'Wanderungen pro Monat', uk: 'Походи за місяцями' },
	caption: { en: 'Main targets: the summer months', de: 'Hauptziele: die Sommermonate', uk: 'Головні цілі: літні місяці' }
};

const W = 1600;
const H = 900;
const M = { top: 230, right: 120, bottom: 130, left: 120 };
const x = d3.scaleBand().domain(d3.range(VALUES.length)).range([M.left, W - M.right]).padding(0.25);
const y = d3.scaleLinear().domain([0, d3.max(VALUES) ?? 1]).nice().range([H - M.bottom, M.top]);

/**
 * CSS colours may be oklch() etc., which d3 can't interpolate; resolve them to rgb through a canvas.
 * @param {string} css
 */
function rgb(css) {
	const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	if (!c) return css;
	c.canvas.width = c.canvas.height = 1;
	c.fillStyle = '#000';
	c.fillStyle = css;
	c.fillRect(0, 0, 1, 1);
	const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
	return `rgb(${r}, ${g}, ${b})`;
}

/**
 * @typedef {{ svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, state: number,
 *   colors: { fg: string, muted: string, accent: string, accent2: string, dim: string } }} Mount
 */
/** @type {WeakMap<SlideContext, Mount>} */
const mounts = new WeakMap();

/** @param {SlideContext} ctx */
const readColors = (ctx) => ({
	fg: rgb(ctx.color('fg')),
	muted: rgb(ctx.color('muted')),
	accent: rgb(ctx.color('accent')),
	accent2: rgb(ctx.color('accent2')),
	dim: rgb(ctx.color('dim'))
});

/** @param {Mount} m @param {number} state @param {number} i */
const barFill = (m, state, i) => (state >= 1 && !MAIN.has(i) ? m.colors.dim : m.colors.accent);

/** Stops every transition on the slide. @param {Mount} m */
function interrupt(m) {
	m.svg.selectAll('*').interrupt();
}

/** Puts the chart into `state` instantly: geometry, colours and text. @param {SlideContext} ctx @param {Mount} m @param {number} state */
function render(ctx, m, state) {
	interrupt(m);
	m.state = state;
	const months = MONTHS[ctx.lang] ?? MONTHS.en;
	const { svg, colors } = m;
	svg.select('.title').attr('fill', colors.fg).text(ctx.t(TEXT.title));
	svg.select('.axis').attr('stroke', colors.muted);
	svg.selectAll('.bar').attr('y', (_, i) => y(VALUES[i])).attr('height', (_, i) => y(0) - y(VALUES[i]))
		.attr('fill', (_, i) => barFill(m, state, i));
	svg.selectAll('.value').attr('opacity', 1).attr('fill', colors.fg);
	svg.selectAll('.month').attr('fill', colors.muted).text((_, i) => months[i]);
	const cap = svg.select('.caption').attr('opacity', state >= 1 ? 1 : 0);
	cap.select('path').attr('stroke', colors.accent2);
	cap.select('text').attr('fill', colors.accent2).text(ctx.t(TEXT.caption));
}

/**
 * Handle over a set of running d3 transitions; finish() interrupts them and renders the end state.
 * @param {SlideContext} ctx @param {Mount} m @param {number} state @param {d3.Transition<any, any, any, any>[]} ts
 * @returns {StepHandle}
 */
function handle(ctx, m, state, ts) {
	m.state = state;
	return {
		finish: () => render(ctx, m, state),
		// end() rejects when interrupted; either way the run is over.
		finished: Promise.all(ts.map((t) => t.end())).catch(() => {})
	};
}

/** @type {SlideDef} */
export default {
	name: 'bars',
	label: { en: 'Bar chart', de: 'Balkendiagramm', uk: 'Стовпчикова діаграма' },
	states: [{ name: 'grow' }, { name: 'highlight' }],

	mount(ctx) {
		const svg = d3.select(ctx.root).append('svg')
			.attr('viewBox', `0 0 ${W} ${H}`)
			.attr('role', 'img')
			.style('position', 'absolute').style('inset', '0').style('width', '100%').style('height', '100%');
		svg.append('text').attr('class', 'title').attr('x', W / 2).attr('y', 110)
			.attr('text-anchor', 'middle').attr('font-size', 56).attr('font-weight', 700);
		const bars = svg.append('g').selectAll('g').data(VALUES).join('g');
		bars.append('rect').attr('class', 'bar').attr('rx', 8)
			.attr('x', (_, i) => x(i) ?? 0).attr('width', x.bandwidth());
		bars.append('text').attr('class', 'value').attr('text-anchor', 'middle').attr('font-size', 32)
			.attr('x', (_, i) => (x(i) ?? 0) + x.bandwidth() / 2).attr('y', (d) => y(d) - 16).text((d) => d);
		bars.append('text').attr('class', 'month').attr('text-anchor', 'middle').attr('font-size', 32)
			.attr('x', (_, i) => (x(i) ?? 0) + x.bandwidth() / 2).attr('y', H - M.bottom + 52);
		svg.append('line').attr('class', 'axis').attr('stroke-width', 3)
			.attr('x1', M.left - 20).attr('x2', W - M.right + 20).attr('y1', y(0)).attr('y2', y(0));
		// Bracket over the main bars, with the caption above it.
		const first = x(Math.min(...MAIN)) ?? 0;
		const last = (x(Math.max(...MAIN)) ?? 0) + x.bandwidth();
		const top = y(d3.max([...MAIN].map((i) => VALUES[i])) ?? 0) - 64;
		const cap = svg.append('g').attr('class', 'caption');
		cap.append('path').attr('fill', 'none').attr('stroke-width', 4)
			.attr('d', `M${first},${top + 20}V${top}H${last}V${top + 20}`);
		cap.append('text').attr('x', (first + last) / 2).attr('y', top - 20)
			.attr('text-anchor', 'middle').attr('font-size', 36).attr('font-weight', 600);
		mounts.set(ctx, { svg, state: 0, colors: readColors(ctx) });
	},

	snap(ctx, state) {
		const m = mounts.get(ctx);
		if (m) render(ctx, m, state);
	},

	enter(ctx, state, direction, animate) {
		const m = mounts.get(ctx);
		if (!m || !animate || direction !== 'forward' || state !== 0) return;
		render(ctx, m, state);
		const base = y(0);
		const grow = m.svg.selectAll('.bar').attr('y', base).attr('height', 0)
			.transition().duration(800).delay((_, i) => i * 70).ease(d3.easeCubicOut)
			.attr('y', (_, i) => y(VALUES[i])).attr('height', (_, i) => base - y(VALUES[i]));
		const values = m.svg.selectAll('.value').attr('opacity', 0)
			.transition().duration(300).delay((_, i) => 500 + i * 70).attr('opacity', 1);
		return handle(ctx, m, state, [grow, values]);
	},

	step(ctx, from, to) {
		const m = mounts.get(ctx);
		if (!m) return;
		render(ctx, m, from);
		const bars = m.svg.selectAll('.bar').transition().duration(600).ease(d3.easeCubicInOut)
			.attr('fill', (_, i) => barFill(m, to, i));
		const cap = m.svg.select('.caption').transition().duration(500).delay(to > from ? 250 : 0)
			.attr('opacity', to >= 1 ? 1 : 0);
		return handle(ctx, m, to, [bars, cap]);
	},

	finish(ctx) {
		const m = mounts.get(ctx);
		if (m) render(ctx, m, m.state);
	},

	update(ctx) {
		const m = mounts.get(ctx);
		if (!m) return;
		m.colors = readColors(ctx);
		render(ctx, m, m.state);
	},

	unmount(ctx) {
		const m = mounts.get(ctx);
		if (m) interrupt(m);
		mounts.delete(ctx);
	}
};
