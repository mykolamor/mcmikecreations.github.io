// Slide 4: a three.js cube with OrbitControls (the canvas claims drag and key input). The second state
// tweens the camera to another viewpoint with anime.js. The scene is built once per mount and only
// moved afterwards; the render loop runs only between enter and leave. Grid thumbnails are images
// captured from the canvas (thumbnail: 'image').
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { animate } from 'animejs';

/** @typedef {import('../../../../../../src/lib/presentation/types').SlideContext} SlideContext */
/** @typedef {import('../../../../../../src/lib/presentation/types').SlideDef} SlideDef */

const W = 1600;
const H = 900;
/** Camera viewpoints per state, all looking at TARGET. */
const VIEWS = [new THREE.Vector3(4.5, 3.2, 6.5), new THREE.Vector3(-6.2, 5.5, -3.6)];
const TARGET = new THREE.Vector3(0, 1, 0);

const TEXT = {
	title: { en: 'A live 3D scene', de: 'Eine lebendige 3D-Szene', uk: 'Жива 3D-сцена' },
	hint: {
		en: 'Drag to orbit; in fullscreen, scroll to zoom. Esc gives the arrow keys back to the slides.',
		de: 'Ziehen zum Drehen, im Vollbild scrollen zum Zoomen. Esc gibt die Pfeiltasten an die Folien zurück.',
		uk: 'Перетягніть, щоб обертати; у повноекранному режимі прокрутіть для масштабу. Esc повертає стрілки слайдам.'
	}
};

/**
 * CSS colours may be oklch() etc., which THREE.Color can't parse; resolve them to rgb through a canvas.
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
 * @typedef {{
 *   renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
 *   controls: OrbitControls | null, cube: THREE.Mesh, edges: THREE.LineSegments, grid: THREE.GridHelper | null,
 *   title: HTMLElement, hint: HTMLElement, raf: number, tween: import('animejs').JSAnimation | null, state: number
 * }} Mount
 */
/** @type {WeakMap<SlideContext, Mount>} */
const mounts = new WeakMap();

/** @param {Mount} m */
function draw(m) {
	m.renderer.render(m.scene, m.camera);
}

/** @param {Mount} m @param {THREE.Vector3} pos @param {THREE.Vector3} target */
function pose(m, pos, target) {
	m.camera.position.copy(pos);
	if (m.controls) {
		m.controls.target.copy(target);
		m.controls.update();
	} else {
		m.camera.lookAt(target);
	}
}

/** Colours and text from the current theme and language. @param {SlideContext} ctx @param {Mount} m */
function paint(ctx, m) {
	const fg = rgb(ctx.color('fg'));
	m.renderer.setClearColor(new THREE.Color(rgb(ctx.color('bg'))), 1);
	/** @type {THREE.MeshStandardMaterial} */ (m.cube.material).color.set(rgb(ctx.color('accent')));
	/** @type {THREE.LineBasicMaterial} */ (m.edges.material).color.set(fg);
	// GridHelper bakes its colours into the geometry, so swap it.
	if (m.grid) {
		m.scene.remove(m.grid);
		m.grid.geometry.dispose();
		/** @type {THREE.Material} */ (m.grid.material).dispose();
	}
	m.grid = new THREE.GridHelper(12, 12, rgb(ctx.color('muted')), rgb(ctx.color('dim')));
	m.scene.add(m.grid);
	m.title.textContent = ctx.t(TEXT.title);
	m.title.style.color = fg;
	m.hint.textContent = ctx.t(TEXT.hint);
	m.hint.style.color = ctx.color('muted');
	m.hint.style.display = ctx.isThumbnail ? 'none' : '';
	draw(m);
}

/** @param {Mount} m */
function stop(m) {
	if (m.raf) cancelAnimationFrame(m.raf);
	m.raf = 0;
}

/** @type {SlideDef} */
export default {
	name: 'scene',
	label: { en: '3D scene', de: '3D-Szene', uk: '3D-сцена' },
	states: [{ name: 'cube' }, { name: 'orbit' }],
	thumbnail: 'image',

	thumbnails(ctx) {
		const m = mounts.get(ctx);
		if (!m) return '';
		draw(m);
		return m.renderer.domElement.toDataURL('image/jpeg', 0.85);
	},

	mount(ctx) {
		const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
		renderer.setPixelRatio(ctx.isThumbnail ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.5));
		renderer.setSize(W, H, false);
		const canvas = renderer.domElement;
		canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;';

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
		scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
		const sun = new THREE.DirectionalLight(0xffffff, 2);
		sun.position.set(5, 8, 4);
		scene.add(sun);
		const geometry = new THREE.BoxGeometry(2, 2, 2);
		const cube = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 }));
		cube.position.copy(TARGET);
		const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial());
		cube.add(edges);
		scene.add(cube);

		const overlay = document.createElement('div');
		overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;padding:64px 96px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;';
		const title = document.createElement('h2');
		title.style.cssText = 'margin:0;font-size:56px;font-weight:700;';
		const hint = document.createElement('p');
		hint.style.cssText = 'margin:0;font-size:28px;';
		overlay.append(title, hint);
		ctx.root.append(canvas, overlay);

		/** @type {OrbitControls | null} */
		let controls = null;
		if (!ctx.isThumbnail) {
			controls = new OrbitControls(camera, canvas);
			controls.listenToKeyEvents(canvas);
			canvas.tabIndex = 0;
			canvas.setAttribute('aria-label', 'Interactive 3D cube');
			// Keys go to the canvas once it has focus (the frame lets claimed elements keep the arrows).
			canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }), { signal: ctx.signal });
			ctx.claimInput(canvas, ['drag', 'keys']);
			// Zoom only in fullscreen (native or the overlay fallback; the frame marks both with
			// .pres-fullscreen): inline, the wheel must keep scrolling the page. Decided per gesture, in the
			// capture phase on the slide root, so it's set before OrbitControls' own canvas listeners run.
			const syncZoom = () => {
				if (controls) controls.enableZoom = canvas.closest('.pres-fullscreen') !== null;
			};
			syncZoom();
			for (const type of ['wheel', 'pointerdown']) {
				ctx.root.addEventListener(type, syncZoom, { capture: true, passive: true, signal: ctx.signal });
			}
		}

		/** @type {Mount} */
		const m = { renderer, scene, camera, controls, cube, edges, grid: null, title, hint, raf: 0, tween: null, state: 0 };
		mounts.set(ctx, m);
		ctx.signal.addEventListener('abort', () => stop(m), { once: true });
		pose(m, VIEWS[0], TARGET);
		paint(ctx, m);
	},

	snap(ctx, state) {
		const m = mounts.get(ctx);
		if (!m) return;
		m.tween?.cancel();
		m.tween = null;
		m.state = state;
		pose(m, VIEWS[state], TARGET);
		draw(m);
	},

	step(ctx, from, to) {
		const m = mounts.get(ctx);
		if (!m) return;
		m.tween?.cancel();
		m.state = to;
		const view = VIEWS[to];
		const c = m.camera.position;
		const t = m.controls?.target ?? TARGET;
		// Tween from wherever the user orbited to, back onto the state's viewpoint.
		const p = { x: c.x, y: c.y, z: c.z, tx: t.x, ty: t.y, tz: t.z };
		const apply = () => {
			pose(m, new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(p.tx, p.ty, p.tz));
			if (!m.raf) draw(m);
		};
		const tween = animate(p, {
			x: view.x, y: view.y, z: view.z, tx: TARGET.x, ty: TARGET.y, tz: TARGET.z,
			duration: 1200,
			ease: 'inOutCubic',
			onUpdate: apply
		});
		m.tween = tween;
		return {
			finish: () => {
				tween.complete();
				pose(m, view, TARGET);
				if (!m.raf) draw(m);
			},
			finished: tween.then()
		};
	},

	enter(ctx) {
		const m = mounts.get(ctx);
		if (!m || ctx.isThumbnail || m.raf || ctx.signal.aborted) return;
		const tick = () => {
			if (ctx.signal.aborted) return stop(m);
			if (!ctx.reducedMotion) m.cube.rotation.y += 0.004;
			m.controls?.update();
			draw(m);
			m.raf = requestAnimationFrame(tick);
		};
		m.raf = requestAnimationFrame(tick);
	},

	leave(ctx) {
		const m = mounts.get(ctx);
		if (m) stop(m);
	},

	finish(ctx) {
		const m = mounts.get(ctx);
		if (!m?.tween) return;
		m.tween.complete();
		pose(m, VIEWS[m.state], TARGET);
		draw(m);
	},

	update(ctx) {
		const m = mounts.get(ctx);
		if (m) paint(ctx, m);
	},

	unmount(ctx) {
		const m = mounts.get(ctx);
		if (!m) return;
		mounts.delete(ctx);
		stop(m);
		m.tween?.cancel();
		m.controls?.dispose();
		m.scene.traverse((o) => {
			const obj = /** @type {THREE.Mesh} */ (o);
			obj.geometry?.dispose();
			const mat = obj.material;
			if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
			else mat?.dispose();
		});
		m.renderer.dispose();
		m.renderer.forceContextLoss();
		m.renderer.domElement.remove();
	}
};
