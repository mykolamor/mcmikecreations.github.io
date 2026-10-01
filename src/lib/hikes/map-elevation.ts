import { select, pointer, scaleLinear, line as d3Line, area as d3Area, curveMonotoneX, axisBottom, axisLeft, bisectLeft } from 'd3';
import { primaryGeometryColor, secondaryIndicatorColor } from '$lib/hikes/build-geometry';
import { computeMetricScales, haversineKm, type HikeMetrics } from '$lib/hikes/hike-metrics';

interface ElevationPoint {
    dist: number; // km (already scaled to the authoritative distance)
    ele: number;  // m (raw track elevation)
    lat: number;
    lon: number;
}

export function initElevationChart(
    container: HTMLElement,
    geojson: any,
    onHover?: (lat: number, lon: number, ele: number, dist: number) => void,
    onLeave?: () => void,
    metrics?: Partial<HikeMetrics> | null
): { setIndicator: (lat: number, lon: number, preferredDist?: number) => void; hideIndicator: () => void } {
    let internalPoints: ElevationPoint[] = [];
    const coords: number[][] = geojson?.features?.[0]?.geometry?.coordinates;
    if (!coords?.length) return { setIndicator: () => {}, hideIndicator: () => {} };

    // Distances are stretched so the total matches the authoritative distance;
    // elevations are the track's own (see computeMetricScales).
    const { distanceFactor } = computeMetricScales(coords, metrics);

    const points: ElevationPoint[] = [];
    let cumDist = 0;
    for (let i = 0; i < coords.length; i++) {
        if (i > 0) cumDist += haversineKm(coords[i - 1], coords[i]) * distanceFactor;
        points.push({ dist: cumDist, ele: coords[i][2] ?? 0, lat: coords[i][1], lon: coords[i][0] });
    }
    const distArray = points.map(p => p.dist);

    const margin = { top: 14, right: 16, bottom: 38, left: 56 };
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
