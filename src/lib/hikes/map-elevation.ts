import { select, pointer, scaleLinear, line as d3Line, area as d3Area, curveMonotoneX, axisBottom, axisLeft, bisectLeft } from 'd3';
import { primaryGeometryColor, secondaryIndicatorColor } from '$lib/hikes/build-geometry';
import { computeMetricScales, cumulativeKm, type HikeMetrics } from '$lib/hikes/hike-metrics';
import { pinColor, pinEmojis, pinKinds, pinText, type FactsBand, type FactsPin } from '$lib/hikes/facts-overlay';

interface ElevationPoint {
    dist: number; // km (already scaled to the authoritative distance)
    ele: number;  // m (raw track elevation)
    lat: number;
    lon: number;
}

/** A photo's place on the profile: `km` on the chart's own (stretched) distance scale. */
export interface ElevationPhotoTick {
    km: number;
    mediaIndex: number;
    alt?: string;
}

const PHOTO_TICK_SIZE = 7;
/** Height of the SAC-grade band row and the hazard row above the plot. */
const GRADE_BAND_H = 10;
const HAZARD_BAND_H = 3;
const BAND_GAP = 1;
/** Facts pins: a pill of emojis standing on a stem above the profile line. */
const PIN_STEM = 9;
const PIN_H = 14;
const PIN_EMOJI_W = 11;

/** The facts layer's marks on the chart: see `facts-overlay.ts`. */
export interface ElevationFacts {
    bands: FactsBand[];
    pins: FactsPin[];
    onPinClick?: (pin: FactsPin) => void;
}

export function initElevationChart(
    container: HTMLElement,
    geojson: any,
    onHover?: (lat: number, lon: number, ele: number, dist: number) => void,
    onLeave?: () => void,
    metrics?: Partial<HikeMetrics> | null,
    photoTicks?: ElevationPhotoTick[],
    onPhotoClick?: (mediaIndex: number) => void,
    facts?: ElevationFacts
): { setIndicator: (lat: number, lon: number, preferredDist?: number) => void; hideIndicator: () => void } {
    let internalPoints: ElevationPoint[] = [];
    const coords: number[][] = geojson?.features?.[0]?.geometry?.coordinates;
    if (!coords?.length) return { setIndicator: () => {}, hideIndicator: () => {} };

    // Distances are stretched so the total matches the authoritative distance;
    // elevations are the track's own (see computeMetricScales).
    const { distanceFactor } = computeMetricScales(coords, metrics);

    const cum = cumulativeKm(coords, distanceFactor);
    const points: ElevationPoint[] = coords.map((c, i) => ({ dist: cum[i], ele: c[2] ?? 0, lat: c[1], lon: c[0] }));
    const distArray = points.map(p => p.dist);

    // Room above the plot for the grade and hazard bands, when there are any.
    const bandRows = facts?.bands.length ? GRADE_BAND_H + BAND_GAP + HAZARD_BAND_H + 4 : 0;
    const margin = { top: 14 + bandRows, right: 16, bottom: 38, left: 56 };
    const VW = 600;
    const VH = 190;
    const iW = VW - margin.left - margin.right; // inner width
    const iH = VH - margin.top - margin.bottom; // inner height

    const eleMin = Math.min(...points.map(p => p.ele));
    const eleMax = Math.max(...points.map(p => p.ele));
    const elePad = Math.max((eleMax - eleMin) * 0.08, 10);
    const distMax = points[points.length - 1].dist;

    const xScale = scaleLinear().domain([0, distMax]).range([0, iW]);
    const yScale = scaleLinear().domain([eleMin - elePad, eleMax + elePad]).range([iH, 0]);

    const svg = select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${VW} ${VH}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('width', '100%')
        .style('height', 'auto')
        .style('display', 'block')
        .style('overflow', 'visible');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    let setIndicatorFn = (lat: number, lon: number) => {};

    // Area fill
    g.append('path')
        .datum(points)
        .attr('fill', primaryGeometryColor)
        .attr('fill-opacity', 0.15)
        .attr('d', d3Area<ElevationPoint>()
            .x(p => xScale(p.dist))
            .y0(iH)
            .y1(p => yScale(p.ele))
            .curve(curveMonotoneX));

    // Elevation line
    g.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', primaryGeometryColor)
        .attr('stroke-width', 2)
        .attr('d', d3Line<ElevationPoint>()
            .x(p => xScale(p.dist))
            .y(p => yScale(p.ele))
            .curve(curveMonotoneX));

    // X axis
    const xAxisG = g.append('g').attr('transform', `translate(0,${iH})`).call(
        axisBottom(xScale).ticks(6).tickFormat((d: any) => `${(d as number).toFixed(1)} km`)
    );
    xAxisG.select('.domain').attr('stroke', '#9ca3af');
    xAxisG.selectAll('.tick line').attr('stroke', '#9ca3af');
    xAxisG.selectAll('text').attr('fill', '#6b7280').style('font-size', '11px');

    // Y axis (labels scaled to the authoritative vertical range; curve shape unchanged)
    const yAxisG = g.append('g').call(
        axisLeft(yScale).ticks(5).tickFormat((d: any) => `${Math.round(d as number)} m`)
    );
    yAxisG.select('.domain').attr('stroke', '#9ca3af');
    yAxisG.selectAll('.tick line').attr('stroke', '#9ca3af');
    yAxisG.selectAll('text').attr('fill', '#6b7280').style('font-size', '11px');

    // Gridlines (horizontal, subtle)
    g.append('g')
        .attr('class', 'grid')
        .call(axisLeft(yScale).ticks(5).tickSize(-iW).tickFormat(() => ''))
        .call(gg => gg.select('.domain').remove())
        .call(gg => gg.selectAll('line').attr('stroke', '#e5e7eb').attr('stroke-dasharray', '3 2'));

    // --- Interactive cursor group (hidden until hover) ---
    const cursor = g.append('g').attr('visibility', 'hidden').attr('pointer-events', 'none');

    cursor.append('line')
        .attr('class', 'cur-line')
        .attr('y1', 0).attr('y2', iH)
        .attr('stroke', '#9ca3af')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 3');

    cursor.append('circle')
        .attr('class', 'cur-dot')
        .attr('r', 5)
        .attr('fill', secondaryIndicatorColor)
        .attr('stroke', 'white')
        .attr('stroke-width', 2);

    // Elevation label: rect + text
    const eleLabelG = cursor.append('g').attr('class', 'ele-label-g');
    eleLabelG.append('rect')
        .attr('class', 'ele-label-bg')
        .attr('height', 18).attr('rx', 3)
        .attr('fill', 'white').attr('fill-opacity', 0.9)
        .attr('stroke', '#d1d5db').attr('stroke-width', 0.5);
    eleLabelG.append('text')
        .attr('class', 'ele-label-text')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '11px')
        .attr('fill', '#374151');

    // Distance label below x axis
    cursor.append('text')
        .attr('class', 'dist-label')
        .attr('y', iH + 30)
        .attr('text-anchor', 'middle')
        .attr('font-size', '11px')
        .attr('fill', '#6b7280');

    const handlePointerAction = (event: PointerEvent) => {
        const [mx] = pointer(event);
        const dist = xScale.invert(Math.max(0, Math.min(mx, iW)));
        const i = Math.max(0, Math.min(bisectLeft(distArray, dist), points.length - 1));
        const pt = points[i];

        updateCursor(pt);

        onHover?.(pt.lat, pt.lon, pt.ele, pt.dist);
    };

    // Transparent overlay to capture pointer events
    g.append('rect')
        .attr('width', iW).attr('height', iH)
        .attr('fill', 'transparent')
        .style('cursor', 'crosshair')
        .style('touch-action', 'none')
        .on('pointerdown', handlePointerAction)
        .on('pointermove', handlePointerAction)
        .on('pointerup', () => {
            // Optional: You could hide on pointerup for touch devices, but keeping it visible is fine
        })
        .on('pointerleave', () => {
            cursor.attr('visibility', 'hidden');
            onLeave?.();
        });

    /** The profile point nearest `km`. */
    const nearestPoint = (km: number): ElevationPoint =>
        points[Math.max(0, Math.min(bisectLeft(distArray, km), points.length - 1))];
    /** A marker's group: hovering it moves the cursor (and the maps) to `pt`, clicking calls `onClick`. */
    const hoverGroup = (parent: any, pt: ElevationPoint, onClick?: () => void) => parent.append('g')
        .style('cursor', onClick ? 'pointer' : 'default')
        .on('pointerenter', () => {
            updateCursor(pt);
            onHover?.(pt.lat, pt.lon, pt.ele, pt.dist);
        })
        .on('pointerleave', () => {
            cursor.attr('visibility', 'hidden');
            onLeave?.();
        })
        .on('click', () => onClick?.());

    // Photo ticks: small markers standing on the x axis, drawn above the
    // overlay so they take their own hover and click. Keyboard users reach the
    // same photos through the caption lines, so the ticks stay out of the tab order.
    if (photoTicks?.length) {
        const ticksG = g.append('g').attr('aria-hidden', 'true');
        const half = PHOTO_TICK_SIZE / 2;
        for (const tick of photoTicks) {
            if (!(tick.km >= 0 && tick.km <= distMax)) continue;
            const x = xScale(tick.km);
            const tickG = hoverGroup(ticksG, nearestPoint(tick.km), onPhotoClick && (() => onPhotoClick(tick.mediaIndex)));
            if (tick.alt) tickG.append('title').text(tick.alt);
            // A wider transparent hit area than the visible marker.
            tickG.append('rect')
                .attr('x', x - half - 3).attr('y', iH - PHOTO_TICK_SIZE - 4)
                .attr('width', PHOTO_TICK_SIZE + 6).attr('height', PHOTO_TICK_SIZE + 8)
                .attr('fill', 'transparent');
            tickG.append('path')
                .attr('d', `M${x},${iH - PHOTO_TICK_SIZE} L${x + half},${iH} L${x - half},${iH} Z`)
                .attr('fill', secondaryIndicatorColor)
                .attr('stroke', 'white')
                .attr('stroke-width', 1);
        }
    }

    if (facts?.bands.length) {
        // Row 0: SAC grade per section; row 1: hazards along a stretch. Above
        // the plot, so the profile stays readable underneath.
        const bandsG = g.append('g').attr('aria-hidden', 'true');
        for (const band of facts.bands) {
            const x0 = xScale(Math.max(0, band.from));
            const x1 = xScale(Math.min(distMax, band.to));
            if (!(x1 > x0)) continue;
            const y = band.row === 0 ? -(GRADE_BAND_H + BAND_GAP + HAZARD_BAND_H + 2) : -(HAZARD_BAND_H + 2);
            const h = band.row === 0 ? GRADE_BAND_H : HAZARD_BAND_H;
            const bandG = bandsG.append('g');
            bandG.append('title').text(band.title);
            bandG.append('rect')
                .attr('x', x0).attr('y', y).attr('width', x1 - x0).attr('height', h)
                .attr('rx', 1.5)
                .attr('fill', band.color)
                .attr('fill-opacity', band.row === 0 ? 0.85 : 0.6)
                .attr('stroke', 'white').attr('stroke-width', 0.5);
            if (band.row === 0 && band.text && x1 - x0 > band.text.length * 5 + 4) {
                bandG.append('text')
                    .attr('x', (x0 + x1) / 2).attr('y', y + h / 2)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-size', '8px').attr('font-weight', 600).attr('fill', 'white')
                    .attr('pointer-events', 'none')
                    .text(band.text);
            }
        }
    }

    // Facts pins: hazards, bailout points and water, standing on the profile
    // line. Like the photo ticks, out of the tab order: the facts block lists
    // the same places as links.
    if (facts?.pins.length) {
        const pinsG = g.append('g').attr('aria-hidden', 'true');
        // Boxes of the pins drawn so far; a pin that would overlap one is stacked above it.
        const placed: { x0: number; x1: number; top: number }[] = [];
        for (const pin of facts.pins) {
            if (pin.km == null || !(pin.km >= 0 && pin.km <= distMax)) continue;
            const pt = nearestPoint(pin.km);
            const x = xScale(pin.km);
            const y = yScale(pt.ele);
            const emojis = pinEmojis(pin);
            const w = pinKinds(pin).length * PIN_EMOJI_W + 6;
            let top = Math.max(-bandRows, y - PIN_STEM - PIN_H);
            const x0 = x - w / 2 - 1;
            const x1 = x + w / 2 + 1;
            for (let hit = true; hit; ) {
                hit = false;
                for (const b of placed) {
                    if (x0 < b.x1 && x1 > b.x0 && top < b.top + PIN_H + 1 && top + PIN_H + 1 > b.top) {
                        top = b.top - PIN_H - 2;
                        hit = true;
                    }
                }
            }
            placed.push({ x0, x1, top });
            const onPinClick = facts.onPinClick;
            const pinG = hoverGroup(pinsG, pt, onPinClick && (() => onPinClick(pin)));
            pinG.append('title').text(pinText(pin));
            pinG.append('line')
                .attr('x1', x).attr('x2', x).attr('y1', top + PIN_H).attr('y2', y)
                .attr('stroke', pinColor(pin)).attr('stroke-width', 1.5);
            pinG.append('rect')
                .attr('x', x - w / 2).attr('y', top).attr('width', w).attr('height', PIN_H)
                .attr('rx', PIN_H / 2)
                .attr('fill', 'white')
                .attr('stroke', pinColor(pin)).attr('stroke-width', 1.5);
            pinG.append('text')
                .attr('x', x).attr('y', top + PIN_H / 2 + 0.5)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-size', '9px')
                .text(emojis);
        }
    }

    function updateCursor(pt: ElevationPoint) {
        if (!pt) {
            cursor.attr('visibility', 'hidden');
            return;
        }
        const cx = xScale(pt.dist);
        const cy = yScale(pt.ele);

        cursor.attr('visibility', 'visible');
        cursor.select('.cur-line').attr('x1', cx).attr('x2', cx);
        cursor.select('.cur-dot').attr('cx', cx).attr('cy', cy);

        // Elevation label positioning
        const labelPad = 5;
        const labelH = 18;
        const labelText = `${pt.ele.toFixed(0)} m`;
        const textEl = cursor.select<SVGTextElement>('.ele-label-text').text(labelText);
        const textW = (textEl.node()?.getBBox().width ?? 40) + labelPad * 2 + 4;
        const labelX = cx > iW / 2 ? cx - textW - labelPad : cx + labelPad;
        const labelY = Math.max(0, Math.min(cy - labelH / 2, iH - labelH));

        cursor.select('.ele-label-bg').attr('x', labelX).attr('y', labelY).attr('width', textW);
        textEl.attr('x', labelX + labelPad + 2).attr('y', labelY + labelH / 2);

        cursor.select('.dist-label').attr('x', cx).text(`${pt.dist.toFixed(2)} km`);
    }

    setIndicatorFn = (lat: number, lon: number, preferredDist?: number) => {
        let minD = Infinity;
        let closestPt: ElevationPoint | null = null;
        for (const pt of points) {
            const d = (pt.lat - lat) ** 2 + (pt.lon - lon) ** 2;
            if (d < minD) { minD = d; closestPt = pt; }
        }
        // For out-and-back routes multiple points share the same lat/lon;
        // break ties by picking the one whose cumulative distance is closest to the hint.
        if (closestPt && preferredDist !== undefined) {
            const tolerance = minD * 4;
            let minDistDiff = Math.abs(closestPt.dist - preferredDist);
            for (const pt of points) {
                const d = (pt.lat - lat) ** 2 + (pt.lon - lon) ** 2;
                if (d <= tolerance) {
                    const diff = Math.abs(pt.dist - preferredDist);
                    if (diff < minDistDiff) { minDistDiff = diff; closestPt = pt; }
                }
            }
        }
        if (closestPt) updateCursor(closestPt);
    };

    return { 
        setIndicator: setIndicatorFn,
        hideIndicator: () => cursor.attr('visibility', 'hidden')
    };
}
