import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { MeshLineGeometry } from '$lib/hikes/meshline/MeshLineGeometry';
import { MeshLineMaterial } from '$lib/hikes/meshline/MeshLineMaterial';
import {
    declutterBy, nodeIconHtml, nodePopupHtml, nodeTitle, photoIconHtml,
    getMapPhotosPref, onMapPhotosPref, setMapPhotosPref,
    NODE_MARKER_SIZE, PHOTO_MARKER_SIZE, type MapPhoto
} from '$lib/hikes/map-utils';

/** Side of the square terrain-depth target markers are occlusion-tested against. */
const DEPTH_TARGET_SIZE = 256;
/** How far above the terrain (m) a marker's occlusion probe sits, so it isn't hidden by the slope it stands on. */
const PROBE_LIFT_METERS = 15;
/**
 * Occlusion hysteresis, as relative slack over the terrain's view distance: a
 * shown marker hides only once clearly behind the terrain, a hidden one shows
 * only once clearly in front. In between (ridge lines, grazing angles, depth
 * quantisation in the coarse target) it keeps its state instead of flickering.
 */
const OCCLUSION_SHOW_TOLERANCE = 0.005;
const OCCLUSION_HIDE_TOLERANCE = 0.03;
/** Marker fade on show/hide; skipped for prefers-reduced-motion. */
const FADE_MS = 150;
/**
 * Minimum time a marker stays shown or hidden before it may flip again. Caps
 * flicker the hysteresis can't absorb: a marker right behind a ridge line can
 * jump from clearly in front to clearly behind with a one-pixel shift in the
 * coarse depth target. A flip held back re-renders once the time is up.
 */
const MIN_STATE_MS = 250;
/** Default height (world units, like the elevation indicator's 20) elevated node markers are raised by. */
const ELEVATED_STEM_HEIGHT = 10;
const STEM_COLOR = '#ffffff';
const STEM_WIDTH = 1;

export interface Map3dNode {
    lat: number;
    lon: number;
    demEle?: number;
    tags?: Record<string, string | null | undefined>;
}

export interface Map3dMarkersOptions {
    container: HTMLElement;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    /** The map's scene group; markers are placed in its local (tile) space. */
    group: THREE.Group;
    /** Terrain-only scene drawn with depth-output tile materials, same transform as `group`. */
    depthScene: THREE.Scene;
    /** `group`-local position of a point at `ele` metres, laid out exactly like the tiles; null off the drawn tiles. */
    terrainPoint: (lat: number, lon: number, ele: number) => THREE.Vector3 | null;
    nodes: Map3dNode[];
    photos: MapPhoto[];
    onPhotoClick?: (mediaIndex: number) => void;
    /** Nodes to raise on a vertical stem above their ground position (e.g. peaks and saddles). */
    elevateNode?: (node: Map3dNode) => boolean;
    /** How far elevated markers are raised, in world units. */
    elevatedStemHeight?: number;
    /** Ask the map for a re-render (marker visibility changed without the camera moving). */
    requestRender: () => void;
}

export interface Map3dMarkers {
    /**
     * Occlusion-test, declutter and position the markers. Call right before each
     * WebGL render: it also shows or hides the elevated markers' stems, which
     * that render then draws.
     */
    update: (scene: THREE.Scene) => void;
    setSize: (size: number) => void;
    /** Closes the node popup (e.g. when the camera starts moving). */
    closePopup: () => void;
    dispose: () => void;
}

interface Marker {
    kind: 'photo' | 'node';
    object: CSS2DObject;
    /** `group`-local occlusion probe: slightly above the anchor, or the top of the stem. */
    probe: THREE.Vector3;
    size: number;
    /** Vertical line from the ground up to an elevated marker; shown only with the marker. */
    stem?: THREE.Mesh;
    /** Last occlusion verdict, the state the hysteresis holds. */
    occluded: boolean;
    /** Currently faded in (vs. faded out and click-through). */
    shown: boolean;
    /** When `shown` last changed (performance.now()); -Infinity until the first change. */
    changedAt: number;
}

/** three's packDepthToRGBA, reversed (bytes are R-most-significant). */
function unpackDepth(buf: Uint8Array, i: number): number {
    return buf[i] / 256 + buf[i + 1] / 65536 + buf[i + 2] / 16777216 + buf[i + 3] / (255 * 16777216);
}

/** Make a marker element a keyboard-reachable button that doesn't start an orbit drag. */
function interactive(el: HTMLElement, label: string, activate: () => void) {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = label;
    el.setAttribute('aria-label', label);
    el.style.cursor = 'pointer';
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { e.stopPropagation(); activate(); });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
}

/**
 * Photo and POI markers over the 3D map. They're HTML (the same markers as the
 * 2D map) laid over the canvas by a CSS2DRenderer, so mountains can't hide them
 * by depth testing. Instead, before every WebGL render the terrain alone is
 * rendered into a small depth target and read back, and a marker is shown only
 * while its probe point is at least as close to the camera as the terrain
 * drawn under it. Nodes picked by `elevateNode` sit on top of a vertical stem
 * (a depth-tested WebGL line) and are occlusion-tested at that raised point.
 */
export function createMap3dMarkers(opts: Map3dMarkersOptions): Map3dMarkers | undefined {
    const { container, renderer, camera, group, depthScene, terrainPoint } = opts;
    const onMap = (p: { lat: number; lon: number; demEle?: number }) =>
        typeof p.demEle === 'number' && terrainPoint(p.lat, p.lon, p.demEle) !== null;
    const photos = opts.photos.filter(onMap);
    const nodes = opts.nodes.filter(onMap);
    if (!photos.length && !nodes.length) return undefined;

    const css = new CSS2DRenderer();
    Object.assign(css.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    container.appendChild(css.domElement);

    const markers: Marker[] = [];
    let flipTimer: ReturnType<typeof setTimeout> | undefined;
    let flipDue = 0;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    /**
     * Hidden markers stay in the overlay, transparent, so they can fade rather
     * than blink; while hidden they don't take clicks or keyboard focus.
     */
    const prepare = (el: HTMLElement) => {
        Object.assign(el.style, {
            opacity: '0', pointerEvents: 'none',
            transition: reducedMotion ? '' : `opacity ${FADE_MS}ms ease`,
        });
        el.tabIndex = -1;
        el.setAttribute('aria-hidden', 'true');
    };
    const setShown = (marker: Marker, shown: boolean) => {
        if (marker.shown === shown) return;
        marker.shown = shown;
        marker.changedAt = performance.now();
        const el = marker.object.element;
        el.style.opacity = shown ? '1' : '0';
        el.style.pointerEvents = shown ? 'auto' : 'none';
        el.tabIndex = shown ? 0 : -1;
        if (shown) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', 'true');
        // WebGL lines can't follow a CSS transition; they snap with the fade's start.
        if (marker.stem) marker.stem.visible = shown;
    };
    // Only called for points `onMap` accepted.
    const at = (lat: number, lon: number, ele: number) => terrainPoint(lat, lon, ele)!;
    const lift = (lat: number, lon: number, ele: number) => at(lat, lon, ele + PROBE_LIFT_METERS);

    // --- Node popup -------------------------------------------------------
    const popupEl = document.createElement('div');
    const popupBox = document.createElement('div');
    Object.assign(popupBox.style, {
        position: 'relative', marginBottom: `${NODE_MARKER_SIZE / 2 + 8}px`, padding: '10px 24px 10px 12px',
        minWidth: '160px', maxWidth: '260px', background: 'white', color: '#111827', borderRadius: '10px',
        boxShadow: '0 3px 14px rgba(0,0,0,.4)', fontSize: '13px', lineHeight: '1.4', textAlign: 'left',
        pointerEvents: 'auto', userSelect: 'text',
    });
    popupEl.appendChild(popupBox);
    const popup = new CSS2DObject(popupEl);
    popup.center.set(0.5, 1);
    popup.visible = false;
    group.add(popup);
    popupEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    popupEl.addEventListener('wheel', (e) => e.stopPropagation());
    let popupOwner: Marker | undefined;

    const closePopup = () => {
        if (!popupOwner) return;
        popupOwner = undefined;
        popup.visible = false;
        opts.requestRender();
    };
    const openPopup = (marker: Marker, tags: Map3dNode['tags']) => {
        popupBox.innerHTML = nodePopupHtml(tags)
            + '<button type="button" aria-label="Close popup" style="position:absolute;top:4px;right:6px;border:0;background:none;font-size:16px;line-height:1;color:#6b7280;cursor:pointer;">×</button>';
        popupBox.querySelector('button')?.addEventListener('click', closePopup);
        popup.position.copy(marker.object.position);
        popup.visible = true;
        popupOwner = marker;
        opts.requestRender();
    };

    // --- Markers ----------------------------------------------------------
    for (const photo of photos) {
        const el = document.createElement('div');
        Object.assign(el.style, { width: `${PHOTO_MARKER_SIZE}px`, height: `${PHOTO_MARKER_SIZE}px` });
        el.innerHTML = photoIconHtml(photo);
        interactive(el, photo.alt || 'Photo', () => opts.onPhotoClick?.(photo.mediaIndex));
        prepare(el);
        const object = new CSS2DObject(el);
        object.position.copy(at(photo.lat, photo.lon, photo.demEle!));
        group.add(object);
        markers.push({
            kind: 'photo', object, probe: lift(photo.lat, photo.lon, photo.demEle!), size: PHOTO_MARKER_SIZE,
            occluded: true, shown: false, changedAt: -Infinity,
        });
    }
    // Stems are drawn in the scene, so the terrain depth-tests them like the route.
    // Their height is in world units; the group scales its local z by scale.z.
    let size = container.offsetWidth || 512;
    const stemMaterial = new MeshLineMaterial({
        color: STEM_COLOR,
        resolution: new THREE.Vector2(size, size),
        lineWidth: STEM_WIDTH,
    });
    const stemLocalHeight = (opts.elevatedStemHeight ?? ELEVATED_STEM_HEIGHT) / group.scale.z;
    for (const node of nodes) {
        const el = document.createElement('div');
        el.innerHTML = nodeIconHtml(node.tags);
        const object = new CSS2DObject(el);
        const ground = at(node.lat, node.lon, node.demEle!);
        let stem: THREE.Mesh | undefined;
        let probe = lift(node.lat, node.lon, node.demEle!);
        if (opts.elevateNode?.(node)) {
            const top = ground.clone().setZ(ground.z + stemLocalHeight);
            stem = new THREE.Mesh(new MeshLineGeometry().setFromPoints([ground, top]), stemMaterial);
            stem.renderOrder = 850; // after the route line (800), like the indicator (900)
            stem.visible = false;
            group.add(stem);
            object.position.copy(top);
            probe = top;
        } else {
            object.position.copy(ground);
        }
        group.add(object);
        const marker: Marker = { kind: 'node', object, probe, size: NODE_MARKER_SIZE, stem, occluded: true, shown: false, changedAt: -Infinity };
        interactive(el, nodeTitle(node.tags), () => (popupOwner === marker ? closePopup() : openPopup(marker, node.tags)));
        prepare(el);
        markers.push(marker);
    }

    // --- Photos layer toggle (the 2D map's "Photos" overlay) ---------------
    let photosEnabled = getMapPhotosPref();
    let toggle: HTMLLabelElement | undefined;
    let unsubscribePhotos: (() => void) | undefined;
    if (photos.length) {
        toggle = document.createElement('label');
        Object.assign(toggle.style, {
            position: 'absolute', top: '10px', right: '10px', display: 'flex', alignItems: 'center', gap: '6px',
            padding: '4px 8px', background: 'white', color: '#111827', borderRadius: '5px',
            boxShadow: '0 1px 5px rgba(0,0,0,.4)', fontSize: '12px', cursor: 'pointer', zIndex: '1',
        });
        toggle.innerHTML = '<input type="checkbox" style="margin:0;" /> Photos';
        toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
        const checkbox = toggle.querySelector('input')!;
        checkbox.checked = photosEnabled;
        checkbox.addEventListener('change', () => setMapPhotosPref(checkbox.checked));
        // Also follows the 2D map's "Photos" overlay on the same page.
        unsubscribePhotos = onMapPhotosPref((on) => {
            photosEnabled = on;
            checkbox.checked = on;
            opts.requestRender();
        });
        container.appendChild(toggle);
    }

    // --- Occlusion --------------------------------------------------------
    const depthTarget = new THREE.WebGLRenderTarget(DEPTH_TARGET_SIZE, DEPTH_TARGET_SIZE);
    const depthPixels = new Uint8Array(DEPTH_TARGET_SIZE * DEPTH_TARGET_SIZE * 4);
    const clearColor = new THREE.Color();
    const world = new THREE.Vector3();
    const ndc = new THREE.Vector3();

    const renderDepth = () => {
        renderer.getClearColor(clearColor);
        const clearAlpha = renderer.getClearAlpha();
        renderer.setRenderTarget(depthTarget);
        renderer.setClearColor(0xffffff, 1); // unpacks to depth 1: nothing drawn, nothing occludes
        renderer.clear();
        renderer.render(depthScene, camera);
        renderer.setRenderTarget(null);
        renderer.setClearColor(clearColor, clearAlpha);
        renderer.readRenderTargetPixels(depthTarget, 0, 0, DEPTH_TARGET_SIZE, DEPTH_TARGET_SIZE, depthPixels);
    };

    /** View distance of the farthest terrain around a target pixel (lenient on ridge lines). */
    const terrainDistance = (px: number, py: number) => {
        const { near, far } = camera;
        let farthest = 0;
        for (let dy = -1; dy <= 1; ++dy) {
            for (let dx = -1; dx <= 1; ++dx) {
                const x = Math.min(Math.max(px + dx, 0), DEPTH_TARGET_SIZE - 1);
                const y = Math.min(Math.max(py + dy, 0), DEPTH_TARGET_SIZE - 1);
                const d = unpackDepth(depthPixels, (y * DEPTH_TARGET_SIZE + x) * 4);
                // Perspective depth -> view distance (three's perspectiveDepthToViewZ).
                farthest = Math.max(farthest, (near * far) / (far - (far - near) * d));
            }
        }
        return farthest;
    };

    /**
     * Update a marker's occlusion state (with hysteresis) and return its screen
     * position (container px) if it's visible, else null.
     */
    const unoccluded = (width: number) => (marker: Marker) => {
        world.copy(marker.probe).applyMatrix4(group.matrixWorld);
        ndc.copy(world).project(camera);
        if (ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) {
            marker.occluded = true;
            return null;
        }
        const px = Math.floor((ndc.x + 1) * 0.5 * DEPTH_TARGET_SIZE);
        const py = Math.floor((ndc.y + 1) * 0.5 * DEPTH_TARGET_SIZE); // GL rows run bottom-up, like NDC y
        const ratio = -world.applyMatrix4(camera.matrixWorldInverse).z / terrainDistance(px, py);
        if (marker.occluded) marker.occluded = ratio > 1 + OCCLUSION_SHOW_TOLERANCE;
        else marker.occluded = ratio > 1 + OCCLUSION_HIDE_TOLERANCE;
        if (marker.occluded) return null;
        return { x: (ndc.x + 1) * 0.5 * width, y: (1 - ndc.y) * 0.5 * width };
    };

    /**
     * Declutter candidates with the ones shown last frame first (each group in
     * priority order), so a marker keeps its place until something actually
     * crowds it out instead of trading places with a neighbour every frame.
     */
    const stickyOrder = (candidates: Marker[]) => [
        ...candidates.filter((m) => m.shown),
        ...candidates.filter((m) => !m.shown),
    ];

    css.setSize(size, size);

    return {
        update: (scene) => {
            // May run before the scene's first render: bring group.matrixWorld up to date.
            scene.updateMatrixWorld();
            renderDepth();
            const project = unoccluded(size);
            // Occlusion state is hysteresis: advance it for every marker each frame,
            // even ones the photos toggle or decluttering leave out.
            const positions = new Map(markers.map((m) => [m, project(m)]));
            const visible = (m: Marker) => positions.get(m) ?? null;
            const shown = new Set<Marker>([
                // Photos first, then nodes, each decluttered among its own kind like the 2D map's layers.
                ...declutterBy(stickyOrder(markers.filter((m) => m.kind === 'photo' && photosEnabled)), visible, PHOTO_MARKER_SIZE),
                ...declutterBy(stickyOrder(markers.filter((m) => m.kind === 'node')), visible, NODE_MARKER_SIZE),
            ]);
            // Apply, but hold back flips of markers that changed state too recently -
            // except hiding photos the Photos toggle just turned off, which is instant.
            const now = performance.now();
            let nextFlipIn = Infinity;
            for (const marker of markers) {
                const want = shown.has(marker);
                if (want === marker.shown) continue;
                const wait = marker.changedAt + MIN_STATE_MS - now;
                const forced = marker.kind === 'photo' && !photosEnabled;
                if (wait > 0 && !forced) nextFlipIn = Math.min(nextFlipIn, wait);
                else setShown(marker, want);
            }
            // The map only renders on camera changes, so re-render once the earliest
            // held flip is due, in case the camera has stopped by then.
            if (nextFlipIn !== Infinity) {
                const due = now + nextFlipIn;
                if (flipTimer === undefined || due < flipDue) {
                    clearTimeout(flipTimer);
                    flipDue = due;
                    flipTimer = setTimeout(() => {
                        flipTimer = undefined;
                        opts.requestRender();
                    }, nextFlipIn + 1);
                }
            }
            popup.visible = !!popupOwner && popupOwner.shown;
            css.render(scene, camera);
            popupEl.style.zIndex = String(markers.length + 1); // above every marker CSS2DRenderer z-sorted
        },
        setSize: (newSize) => {
            size = newSize;
            css.setSize(size, size);
            stemMaterial.uniforms.resolution.value.set(size, size);
        },
        closePopup,
        dispose: () => {
            clearTimeout(flipTimer);
            depthTarget.dispose();
            for (const marker of markers) {
                group.remove(marker.object);
                if (marker.stem) {
                    group.remove(marker.stem);
                    marker.stem.geometry.dispose();
                }
            }
            stemMaterial.dispose();
            group.remove(popup);
            css.domElement.remove();
            toggle?.remove();
            unsubscribePhotos?.();
        },
    };
}
