/**
 * The home page hero's 3D contour map: one hike's terrain as contour lines,
 * its route in the primary colour, slowly orbiting. Each nav label gets an SVG
 * line to one of the hike's peaks, re-projected every frame. Imported lazily
 * (three.js stays off the critical path); see HeroMapSection.svelte.
 */
import * as THREE from 'three';
import { MeshLineGeometry } from '$lib/hikes/meshline/MeshLineGeometry';
import { MeshLineHikeMaterial } from '$lib/hikes/meshline/MeshLineHikeMaterial';
import { assignLabels, contourInterval, fitDistance, reassignLabels, smallestFit, type HeroCandidate, type Point } from '$lib/hikes/hero-map';
import { decodeTerrainRgb, routeRuns, sampleHeight, toUv, type HeightField } from '$lib/hero-map/heightfield';
import { ContourMaterial, createContourUniforms, NO_REVEAL } from '$lib/hero-map/ContourMaterial';

export interface HeroLayout {
	width: number;
	height: number;
	anchors: Point[];
	textBottom: number;
}

export interface HeroConnectors {
	lines: SVGLineElement[];
	dots: SVGCircleElement[];
}

export interface HeroMapHandle {
	/** Moves the connectors' label ends by `dy` px, for labels that scroll with the page. */
	setAnchorShift(dy: number): void;
	destroy(): void;
}

const ORBIT_SECONDS = 120;
const TILT = (35 * Math.PI) / 180;
const FOV = 35;
const VERTICAL_EXAGGERATION = 1.5;
const SEGMENTS = 128;
const ROUTE_LIFT_M = 40;
// Room around the peaks' bounding sphere, for the dots and a little terrain.
const PEAK_MARGIN = 1.15;
// Orbit angles sampled when fitting the camera distance, and how far (px) peaks stay from the free area's edges.
const FIT_ANGLES = 72;
const FIT_MARGIN_PX = 24;
// The reduced-motion view's fixed orbit angle.
const STILL_ANGLE = Math.PI / 4;
// Route width on the ground, drawn like the hike pages' 3D map (world-sized, draped on the DEM on the GPU).
const ROUTE_WIDTH_M = 40;
const EARTH_CIRCUMFERENCE_KM = 40075.016686;
// While orbiting, how often (s) a shorter label-to-peak pairing is looked for, and how long (s) the line ends take to slide over.
const REASSIGN_EVERY_S = 0.5;
const REASSIGN_SLIDE_S = 0.8;
// Entrance timeline (seconds): contours rise, the route draws, the connectors grow.
const REVEAL = { contours: [0, 0.8], route: [0.5, 1.1], connectors: [1.0, 1.5] } as const;

const isDark = () => document.documentElement.classList.contains('dark');
const progress = (t: number, [start, end]: readonly [number, number]) => Math.min(1, Math.max(0, (t - start) / (end - start)));

async function loadHeightField(url: string): Promise<{ field: HeightField; texture: THREE.DataTexture }> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`hero map: ${url} ${response.status}`);
	const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
	// Read before close(): a closed bitmap reports a size of 0.
	const size = bitmap.width;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(bitmap, 0, 0);
	const rgba = ctx.getImageData(0, 0, size, size).data;
	bitmap.close();
	// DataTextures start at v = 0, i.e. the south row: upload the rows bottom-up.
	const flipped = new Uint8Array(rgba.length);
	for (let r = 0; r < size; r++) flipped.set(rgba.subarray(r * size * 4, (r + 1) * size * 4), (size - 1 - r) * size * 4);
	const texture = new THREE.DataTexture(flipped, size, size, THREE.RGBAFormat);
	texture.colorSpace = THREE.NoColorSpace;
	texture.minFilter = texture.magFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return { field: decodeTerrainRgb(rgba, size), texture };
}

export async function initHeroMap(
	container: HTMLElement,
	candidate: HeroCandidate,
	connectors: HeroConnectors,
	layout: () => HeroLayout,
	options: { reducedMotion: boolean }
): Promise<HeroMapHandle> {
	const [{ field, texture }, geojson] = await Promise.all([
		loadHeightField(candidate.heightmap),
		fetch(candidate.route).then((r) => {
			if (!r.ok) throw new Error(`hero map: ${candidate.route} ${r.status}`);
			return r.json();
		})
	]);

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setClearColor(0x000000, 0);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
	container.appendChild(renderer.domElement);

	// Scene units are kilometres; the square is centred on the origin, north = -z.
	const { bounds, minEle, maxEle } = candidate;
	const midLat = (bounds.south + bounds.north) / 2;
	const widthKm = ((bounds.east - bounds.west) / 360) * EARTH_CIRCUMFERENCE_KM * Math.cos((midLat * Math.PI) / 180);
	const vScale = VERTICAL_EXAGGERATION / 1000;
	const toScene = (u: number, v: number, liftM = 0) =>
		new THREE.Vector3((u - 0.5) * widthKm, (sampleHeight(field, u, v) + liftM - minEle) * vScale, -(v - 0.5) * widthKm);

	const scene = new THREE.Scene();
	const plane = new THREE.PlaneGeometry(widthKm, widthKm, SEGMENTS, SEGMENTS);
	plane.rotateX(-Math.PI / 2);
	const uniforms = createContourUniforms(texture, minEle, vScale, contourInterval(minEle, maxEle));
	const depthMesh = new THREE.Mesh(plane, new ContourMaterial(uniforms, true));
	const contourMesh = new THREE.Mesh(plane, new ContourMaterial(uniforms));
	depthMesh.renderOrder = 0;
	contourMesh.renderOrder = 1;
	scene.add(depthMesh, contourMesh);

	// The route uses the hike pages' draped line: its points lie flat in a local
	// frame (x east, y north, z up, in km, centred on the square) and the shader
	// lifts each vertex by the same heightmap the contours read.
	const routeMaterial = new MeshLineHikeMaterial({
		color: '#0d9488',
		map: texture,
		useMap: 0,
		tDisplacement: texture,
		tTileSize: widthKm,
		tScale: vScale,
		tOffset: ROUTE_LIFT_M * vScale,
		resolution: new THREE.Vector2(1, 1),
		depthTest: true
	});
	// Its `visibility` (the draw-in) hides fragments through alpha.
	routeMaterial.transparent = true;
	const routeGroup = new THREE.Group();
	routeGroup.rotation.x = -Math.PI / 2; // local z up -> scene y, local y north -> scene -z
	routeGroup.position.y = -minEle * vScale; // the shader adds absolute heights
	scene.add(routeGroup);
	const routeGeometries: MeshLineGeometry[] = [];
	const feature = geojson?.features?.[0]?.geometry;
	for (const run of feature ? routeRuns(feature, bounds) : []) {
		const geometry = new MeshLineGeometry().setFromPoints(run.map((p) => new THREE.Vector3((p.u - 0.5) * widthKm, (p.v - 0.5) * widthKm, 0)));
		routeGeometries.push(geometry);
		const line = new THREE.Mesh(geometry, routeMaterial);
		line.renderOrder = 2;
		routeGroup.add(line);
	}

	const peaks = candidate.peaks.map((p) => {
		const { u, v } = toUv(bounds, p.lon, p.lat);
		return toScene(u, v);
	});

	const applyTheme = () => {
		uniforms.uColor.value.set(isDark() ? 0xffffff : 0x111827);
		uniforms.uOpacity.value = isDark() ? 0.45 : 0.5;
		const primary = getComputedStyle(document.documentElement).getPropertyValue('--color-primary-600').trim();
		routeMaterial.color = new THREE.Color(primary || '#0d9488');
	};
	applyTheme();

	const camera = new THREE.PerspectiveCamera(FOV, 1, widthKm * 0.05, widthKm * 10);
	// Orbit the peaks, not the square: a sphere around them stays in view at any
	// angle, so every label's line ends on screen. The terrain may spill over.
	const target = peaks.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(Math.max(1, peaks.length));
	const peakRadius = Math.max(widthKm * 0.05, ...peaks.map((p) => p.distanceTo(target))) * PEAK_MARGIN;
	let current = layout();
	let distance = widthKm;
	const resize = () => {
		current = layout();
		const { width, height, textBottom } = current;
		if (width === 0 || height === 0) return;
		renderer.setSize(width, height, false);
		routeMaterial.resolution.set(width, height);
		camera.aspect = width / height;
		// Shift the picture down so the terrain sits in the space under the text block.
		camera.setViewOffset(width, height, 0, -textBottom / 2, width, height);
		camera.updateProjectionMatrix();
		// The line material offsets in clip space, already divided by the aspect: scaling by
		// the focal length (not elements[0], which includes the aspect) keeps the route
		// ROUTE_WIDTH_M wide on the ground on any screen shape.
		routeMaterial.lineWidth = (ROUTE_WIDTH_M / 1000) * camera.projectionMatrix.elements[5];
		// As close as the peaks allow: the sphere around them always fits, so it bounds
		// the search; each orbit angle then gets its own tightest fit, and the farthest
		// of those is kept, so no peak ever leaves the free area while orbiting.
		const sphere = fitDistance(peakRadius, FOV, camera.aspect, Math.max(0.2, (height - textBottom) / height));
		const angles = options.reducedMotion ? [STILL_ANGLE] : Array.from({ length: FIT_ANGLES }, (_, i) => (i / FIT_ANGLES) * 2 * Math.PI);
		distance = Math.max(...angles.map((angle) => smallestFit((d) => peaksFit(angle, d), sphere * 0.2, sphere)));
	};

	let assignment: number[] | null = null;
	// The pairing being slid away from, and when (orbit seconds) the slide began.
	let previous: number[] | null = null;
	let switchedAt = 0;
	let lastCheck = 0;
	let anchorShift = 0;
	const screen = new THREE.Vector3();
	const project = (p: THREE.Vector3): Point => {
		screen.copy(p).project(camera);
		return { x: ((screen.x + 1) / 2) * current.width, y: ((1 - screen.y) / 2) * current.height };
	};
	const placeCamera = (angle: number, d: number) => {
		camera.position.set(
			target.x + d * Math.cos(TILT) * Math.sin(angle),
			target.y + d * Math.sin(TILT),
			target.z + d * Math.cos(TILT) * Math.cos(angle)
		);
		camera.lookAt(target);
		camera.updateMatrixWorld();
	};
	/** Whether every peak lands in the free area under the text, `FIT_MARGIN_PX` clear of its edges. */
	const peaksFit = (angle: number, d: number) => {
		placeCamera(angle, d);
		const { width, height, textBottom } = current;
		return peaks.every((p) => {
			const s = project(p);
			return Math.abs(screen.z) < 1
				&& s.x >= FIT_MARGIN_PX && s.x <= width - FIT_MARGIN_PX
				&& s.y >= textBottom + FIT_MARGIN_PX && s.y <= height - FIT_MARGIN_PX;
		});
	};
	const drawConnectors = (grow: number) => {
		const projected = peaks.map(project);
		const anchors = current.anchors.map((a) => ({ x: a.x, y: a.y + anchorShift }));
		if (!assignment) {
			assignment = assignLabels(anchors, projected);
			previous = null;
		} else if (orbit - lastCheck >= REASSIGN_EVERY_S && !previous) {
			// The orbit turns the peaks under the labels: swap to a clearly shorter pairing.
			lastCheck = orbit;
			const next = reassignLabels(anchors, projected, assignment);
			if (next) {
				previous = assignment;
				assignment = next;
				switchedAt = orbit;
			}
		}
		const slide = previous ? progress(orbit - switchedAt, [0, REASSIGN_SLIDE_S]) : 1;
		const eased = slide * slide * (3 - 2 * slide);
		anchors.forEach((a, i) => {
			const to = projected[assignment![i]];
			const from = previous ? projected[previous[i]] : to;
			const line = connectors.lines[i];
			const dot = connectors.dots[i];
			if (!line || !dot || !to || !from) return;
			const p = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
			const ay = a.y;
			line.setAttribute('x1', `${a.x}`);
			line.setAttribute('y1', `${ay}`);
			line.setAttribute('x2', `${a.x + (p.x - a.x) * grow}`);
			line.setAttribute('y2', `${ay + (p.y - ay) * grow}`);
			dot.setAttribute('cx', `${p.x}`);
			dot.setAttribute('cy', `${p.y}`);
			dot.style.opacity = `${grow}`;
		});
		if (slide >= 1) previous = null;
	};

	let elapsed = options.reducedMotion ? Infinity : 0; // seconds since the scene appeared
	let orbit = 0; // seconds of orbiting, frozen while paused
	let contextLost = false;
	const frame = () => {
		if (contextLost) return;
		placeCamera(options.reducedMotion ? STILL_ANGLE : (orbit / ORBIT_SECONDS) * 2 * Math.PI, distance);
		uniforms.uReveal.value = elapsed === Infinity ? NO_REVEAL : minEle + (maxEle - minEle + 1) * progress(elapsed, REVEAL.contours);
		routeMaterial.visibility = elapsed === Infinity ? 1 : progress(elapsed, REVEAL.route);
		renderer.render(scene, camera);
		drawConnectors(elapsed === Infinity ? 1 : progress(elapsed, REVEAL.connectors));
	};

	let raf = 0;
	let last = 0;
	let onScreen = true;
	const tick = (now: number) => {
		const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
		last = now;
		elapsed += dt;
		orbit += dt;
		frame();
		raf = requestAnimationFrame(tick);
	};
	const running = () => !options.reducedMotion && onScreen && !document.hidden && !contextLost;
	const updateLoop = () => {
		if (running() && !raf) {
			last = 0;
			raf = requestAnimationFrame(tick);
		} else if (!running() && raf) {
			cancelAnimationFrame(raf);
			raf = 0;
		}
	};

	const resizeObserver = new ResizeObserver(() => {
		resize();
		assignment = null;
		if (!raf) frame();
	});
	resizeObserver.observe(container);
	const intersection = new IntersectionObserver(([entry]) => {
		onScreen = entry.isIntersecting;
		updateLoop();
	});
	intersection.observe(container);
	const themeObserver = new MutationObserver(() => {
		applyTheme();
		if (!raf) frame();
	});
	themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
	document.addEventListener('visibilitychange', updateLoop);
	// Browsers drop WebGL contexts (backgrounded mobile tabs, GPU resets). Keep it
	// restorable, then redraw: three.js re-creates its GPU state on restore.
	const onContextLost = (event: Event) => {
		event.preventDefault();
		contextLost = true;
		updateLoop();
	};
	const onContextRestored = () => {
		contextLost = false;
		texture.needsUpdate = true;
		frame();
		updateLoop();
	};
	renderer.domElement.addEventListener('webglcontextlost', onContextLost);
	renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

	resize();
	frame();
	updateLoop();

	return {
		setAnchorShift(dy: number) {
			anchorShift = dy;
			if (!raf) frame();
		},
		destroy() {
			cancelAnimationFrame(raf);
			raf = 0;
			resizeObserver.disconnect();
			intersection.disconnect();
			themeObserver.disconnect();
			document.removeEventListener('visibilitychange', updateLoop);
			renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
			renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
			plane.dispose();
			(depthMesh.material as THREE.Material).dispose();
			(contourMesh.material as THREE.Material).dispose();
			routeGeometries.forEach((g) => g.dispose());
			routeMaterial.dispose();
			texture.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		}
	};
}
