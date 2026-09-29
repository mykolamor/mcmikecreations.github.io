import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshLineGeometry } from '$lib/hikes/meshline/MeshLineGeometry';
import { MeshLineMaterial } from '$lib/hikes/meshline/MeshLineMaterial';
import { TileMaterial } from '$lib/hikes/meshline/TileMaterial';
import { primaryIndicatorColor, primaryGeometryColor } from '$lib/hikes/build-geometry';
import { providerFolder, providers } from '$lib/data/map-providers';
import { geoClipRectangle, geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { tile } from 'd3-tile';
import type { Map } from '$lib/data/map-info';
import { getPixelsPerMeter } from '$lib/hikes/build-tiles';
import { ThreePathContext } from '$lib/hikes/ThreePathContext';
import { MeshLineHikeMaterial } from '$lib/hikes/meshline/MeshLineHikeMaterial';
import { createMap3dMarkers, type Map3dMarkers, type Map3dNode } from '$lib/hikes/map-3d-markers';
import { isPeakOrSaddle, type MapPhoto } from '$lib/hikes/map-utils';

export interface Map3dHandle {
    setIndicator: (lat: number, lon: number, ele: number) => void;
    hideIndicator?: () => void;
    destroy?: () => void;
}

const ZOOM = 13;
// Segments per tile for DEM vertex displacement (higher = smoother terrain, more GPU load)
const TILE_SEGMENTS = 64;
const OFFSET = 1.0;
const USE_ELEVATION = true;
const SCENE_SCALE = 0.2;
const SCENE_SCALE_VERTICAL = 0.4;
const LINE_WIDTH = 2;

// Creates a 1x1 texture that encodes 'altitudeMeters' in Mapbox RGB-DEM format
function makeAltitudeFallback(altitudeMeters: number): THREE.DataTexture {
    // height = -10000 + (R*65536 + G*256 + B) * 0.1  →  encoded = (height + 10000) / 0.1
    const encoded = Math.round((altitudeMeters + 10000) / 0.1);
    const r = (encoded >> 16) & 0xff;
    const g = (encoded >> 8) & 0xff;
    const b = encoded & 0xff;
    const tex = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
}

export function initMap3d(
    container: HTMLElement,
    geojson: any,
    hike: Map,
    nodes?: Map3dNode[] | null,
    photos?: MapPhoto[],
    onPhotoClick?: (mediaIndex: number) => void,
    /** Which nodes to raise on a vertical stem; peaks and saddles unless told otherwise. */
    elevateNode: (node: Map3dNode) => boolean = isPeakOrSaddle
): Map3dHandle {
    const noop: Map3dHandle = { setIndicator: () => {} };
		const geometry = geojson?.features?.[0]?.geometry as (GeoPermissibleObjects & { coordinates: number[][] }) | null;
    const coords: number[][] = geometry?.coordinates ?? [];
    if (!geometry || !coords?.length) return noop;

		const originLon = hike.standardFeatures.origin.lon;
		const originLat = hike.standardFeatures.origin.lat;

		const projection = geoMercator()
				.center([originLon, originLat])
				.scale(Math.pow(2, 21) / (2 * Math.PI))
				.translate([hike.height / 2, hike.height / 2]);
		const tileFunc = tile()
				.size([hike.height, hike.height])
				.scale(projection.scale() * 2 * Math.PI)
				// @ts-ignore
				.translate(projection([0, 0]) ?? [0, 0]);
		const tiles = tileFunc();
		const tileScale = tiles.scale;
		const pixelsPerMeter = getPixelsPerMeter(originLat, tiles.scale, tileFunc.scale()());

    const size = container.offsetWidth || 512;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size, size);
    Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

		const diagDist = Math.sqrt(tiles.length) * tiles.scale;
		const center = projection([originLon, originLat]) ?? [0, 0];
		const cameraPos = diagDist * 0.15625;

		// Aim at the route's elevation so the camera doesn't sit below the terrain.
		// Elevation is placed on local Z (ele * pixelsPerMeter) and mapped to world Y
		// by the group's -PI/2 X-rotation and SCENE_SCALE_VERTICAL scaling.
		const elevations = coords
				.map((c) => c?.[2])
				.filter((v): v is number => typeof v === 'number');
		const refElevation = elevations.length
				? elevations.reduce((a, b) => a + b, 0) / elevations.length
				: 0;
		const refWorldY = refElevation * pixelsPerMeter * SCENE_SCALE_VERTICAL;

    const camera = new THREE.PerspectiveCamera(45, 1, 1, diagDist);
    // camera.position.set(cameraPos[0] - diagDist * 0.25, coords[coords.length / 2][2] + diagDist * 0.55, cameraPos[1] + diagDist * 0.85);
		camera.position.set(-cameraPos, cameraPos + refWorldY, cameraPos);

    const controls = new OrbitControls(camera, renderer.domElement);
		controls.screenSpacePanning = true;
		controls.target.set(0, refWorldY, 0);
		//controls.target.set(center[0] * SCENE_SCALE * 0.5, 0.0, -center[1] * SCENE_SCALE * 0.5);
		//controls.target.set(center[0] * SCENE_SCALE, 0, -center[1] * SCENE_SCALE);
    controls.update();

    // Photo/POI markers, created once the scene is laid out (see below).
    let markers: Map3dMarkers | undefined;
    const render = () => {
        // Markers first: they decide which stems this frame draws.
        markers?.update(scene);
        renderer.render(scene, camera);
    };
    controls.addEventListener('change', render);
    controls.addEventListener('start', () => markers?.closePopup());

    const onResize = () => {
        const width = container.offsetWidth || 512;
        renderer.setSize(width, width, false);
        markers?.setSize(width);
        render();
    };
    window.addEventListener('resize', onResize);

    // Satellite fallback: neutral grey shown before tile image loads
    const satFallback = (() => {
        const t = new THREE.DataTexture(new Uint8Array([60, 70, 80, 255]), 1, 1, THREE.RGBAFormat);
        t.needsUpdate = true;
        return t;
    })();
		const lineFallback = (() => {
				const m = primaryGeometryColor.match(/^#([0-9a-f]{6})$/i)?.at(1) ?? 'ff0000';
				const t = new THREE.DataTexture(new Uint8Array([
						parseInt(m.slice(0,2),16),
						parseInt(m.slice(2,4),16),
						parseInt(m.slice(4,6),16),
						255
				]), 1, 1, THREE.RGBAFormat);
				t.needsUpdate = true;
				return t;
		})();
    // DEM fallback: encodes eleMin so terrain sits at route start elevation when DEM is missing
    const demFallback = makeAltitudeFallback(0.0);

    const textureLoader = new THREE.TextureLoader();
    const tileGeoProto = new THREE.PlaneGeometry(tileScale, tileScale, TILE_SEGMENTS, TILE_SEGMENTS);

		const group = new THREE.Group();
		// Terrain only, drawn with depth-output materials for the markers' occlusion test.
		const wantsMarkers = !!(nodes?.some((n) => typeof n.demEle === 'number') || photos?.some((p) => typeof p.demEle === 'number'));
		const depthScene = new THREE.Scene();
		const depthGroup = new THREE.Group();
		depthScene.add(depthGroup);

		tiles.map((tile : Array<number>) => {
				const tx = tile[0];
				const ty = tile[1];
				// Hardcoded from https://github.com/mykolamor/mcmikecreations.github.io/blob/29c008ef3f7ef722703264d48b3c50d50d8fc2c4/src/lib/hikes/Map3d.svelte#L207
				const satUrl = `/${providerFolder}/maps/${providers.mapboxSatellite.tileset}/${ZOOM}_${tx}_${ty}.${providers.mapboxSatellite.format}`;
				const demUrl = `/${providerFolder}/maps/${providers.mapboxDEM.tileset}/${ZOOM}_${tx}_${ty}.${providers.mapboxDEM.format}`;

				const tileData = {
						x: (tx + tiles.translate[0]) * tileScale,
						y: (ty + tiles.translate[1]) * tileScale,
						scale: tileScale
				};
				const polyCoords = [
						{ x: tileData.x, y: tileData.y },
						{ x: tileData.x, y: tileData.y + tileData.scale },
						{ x: tileData.x + tileData.scale, y: tileData.y + tileData.scale },
						{ x: tileData.x + tileData.scale, y: tileData.y },
				];

				// Start with fallback textures; real textures are loaded asynchronously
				const tileMaterial = new TileMaterial({
						diffuseTexture: satFallback,
						displacementTexture: demFallback,
						tOffset: 0,
						tTileSize: tileScale,
						tScale: pixelsPerMeter,
						uvFromPosition: false,
						colorFromUv: false,
						includeDisplacement: true,
				});

				const plane = new THREE.Mesh(tileGeoProto, tileMaterial);
				plane.position.set(
						Math.round((tx + tiles.translate[0]) * tiles.scale),
						-Math.round((ty + tiles.translate[1]) * tiles.scale),
						0
				);
				group.add(plane);

				if (wantsMarkers) {
						const depthMaterial = new TileMaterial({
								diffuseTexture: satFallback,
								displacementTexture: demFallback,
								tOffset: 0,
								tTileSize: tileScale,
								tScale: pixelsPerMeter,
								uvFromPosition: false,
								colorFromUv: false,
								includeDisplacement: true,
								outputDepth: true,
						});
						// Same uniform object, so the DEM loaded below lifts both meshes alike.
						depthMaterial.uniforms.tDisplacement = tileMaterial.uniforms.tDisplacement;
						const depthPlane = new THREE.Mesh(tileGeoProto, depthMaterial);
						depthPlane.position.copy(plane.position);
						depthGroup.add(depthPlane);
				}

				// Route line: absolute elevation from geojson GPS track, offset 2 units above terrain
				const context = new ThreePathContext();
				projection.postclip(geoClipRectangle(
						polyCoords[0].x,
						polyCoords[0].y,
						polyCoords[2].x,
						polyCoords[2].y
				));
				const path = geoPath(projection, context);
				path(geometry);

				const meshLineMaterial = USE_ELEVATION
						? new MeshLineHikeMaterial({
								tOffset: OFFSET,
								tTileSize: tileScale,
								tScale: pixelsPerMeter,
								map: lineFallback,
								tDisplacement: demFallback,
								depthTest: true,
								useMap: 1,
								resolution: new THREE.Vector2(512, 512),
								lineWidth: LINE_WIDTH
						})
						: new MeshLineMaterial({
								color: primaryGeometryColor,
								resolution: new THREE.Vector2(512, 512),
								lineWidth: LINE_WIDTH
						});
				for (const p of context.paths) {
						const points2d = p.getPoints();
						// @ts-expect-error Erasing geometry type above
						const coordinates : Array<number>[] = geometry.coordinates ?? geometry.geometry?.coordinates ?? [];
						const points = !USE_ELEVATION && points2d.length === coordinates.length
								? points2d.map((v, i) => new THREE.Vector3(
										v.x - tileScale * 0.5 - tileData.x,
										-v.y + tileScale * 0.5 + tileData.y,
										coordinates[i][2] * pixelsPerMeter + OFFSET))
								: points2d.map((v) => new THREE.Vector3(
										v.x - tileScale * 0.5 - tileData.x,
										-v.y + tileScale * 0.5 + tileData.y,
										0.0));

						const buffer = new MeshLineGeometry().setFromPoints( points );

						const line = new THREE.Mesh(buffer, meshLineMaterial);
						line.position.set(tileData.x, -tileData.y, 0);
						line.renderOrder = 800;
						group.add(line);
				}

				textureLoader.load(satUrl, (tex) => {
					tex.minFilter = THREE.LinearFilter;
					tex.magFilter = THREE.LinearFilter;
					tileMaterial.uniforms.tDiffuse.value = tex;
					render();
				});

				textureLoader.load(demUrl, (tex) => {
					tex.minFilter = THREE.NearestFilter;
					tex.magFilter = THREE.NearestFilter;
					tex.generateMipmaps = false;
					tileMaterial.uniforms.tDisplacement.value = tex;
					meshLineMaterial.uniforms.tDisplacement.value = tex;
					meshLineMaterial.needsUpdate = true;
					render();
				});
    });

    // Indicator: sphere + dynamic stem from indicator down to sea level
		const statsIndicator3d = new THREE.Group();
		{
				const offset = 20.0;
				const sphere = new THREE.SphereGeometry(LINE_WIDTH * 1.5 * hike.height / tileScale);
				const sphereMesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({
						color: primaryIndicatorColor,
						depthTest: true,
				}));
				sphereMesh.scale.set(1, 1, SCENE_SCALE_VERTICAL);
				sphereMesh.position.setZ(offset / SCENE_SCALE_VERTICAL);
				statsIndicator3d.add(sphereMesh);

				const resolution = new THREE.Vector2(size, size);
				const line = new MeshLineGeometry().setFromPoints( [
						new THREE.Vector3(0, 0, -1),
						new THREE.Vector3(0, 0, offset / SCENE_SCALE_VERTICAL),
				] );
				const lineMesh = new THREE.Mesh(line, new MeshLineMaterial({
						color: primaryIndicatorColor,
						resolution: resolution,
						lineWidth: LINE_WIDTH,
				}));
				statsIndicator3d.add(lineMesh);
		}
		statsIndicator3d.renderOrder = 900;
		statsIndicator3d.visible = false;
		group.add(statsIndicator3d);

		group.position.set(-center[0] * SCENE_SCALE * 0.5, 0.0, -center[1] * SCENE_SCALE * 0.5); // 0.5 since planes are centered.
		group.rotation.x = -Math.PI * 0.5;
		group.scale.set(SCENE_SCALE, SCENE_SCALE, SCENE_SCALE_VERTICAL);
		scene.add(group);
		depthGroup.position.copy(group.position);
		depthGroup.rotation.copy(group.rotation);
		depthGroup.scale.copy(group.scale);

		// `group`-local position of a point `ele` metres above sea level, placed the
		// way the tiles are: relative to its tile plane's (rounded) position, not the
		// raw projection, and lifted exactly like TileMaterial lifts vertices
		// (height * tScale + tOffset, tOffset being 0 for tiles). With a `demEle`
		// from scripts/matches/terrain.py it lands on the drawn surface. Null off the
		// drawn tiles, where there's no terrain to stand on (or to occlude it).
		const drawnTiles = new Set(tiles.map(([x, y]: number[]) => `${x}_${y}`));
		const terrainPoint = (lat: number, lon: number, ele: number) => {
				const [px, py] = projection([lon, lat]) ?? [0, 0];
				const fx = px / tileScale - tiles.translate[0];
				const fy = py / tileScale - tiles.translate[1];
				const tx = Math.floor(fx);
				const ty = Math.floor(fy);
				if (!drawnTiles.has(`${tx}_${ty}`)) return null;
				return new THREE.Vector3(
						Math.round((tx + tiles.translate[0]) * tiles.scale) - 0.5 * tileScale + (fx - tx) * tileScale,
						-Math.round((ty + tiles.translate[1]) * tiles.scale) + 0.5 * tileScale - (fy - ty) * tileScale,
						ele * pixelsPerMeter
				);
		};

		if (wantsMarkers) {
				markers = createMap3dMarkers({
						container, renderer, camera, group, depthScene, terrainPoint,
						nodes: nodes ?? [],
						photos: photos ?? [],
						onPhotoClick,
						elevateNode,
						requestRender: () => render(),
				});
		}

    THREE.DefaultLoadingManager.onLoad = render;
    render();

    return {
        setIndicator: (lat: number, lon: number, ele: number) => {
            const elevY = ele * pixelsPerMeter + OFFSET;
						const [tx, ty] = projection([lon, lat]) ?? [0, 0];
						statsIndicator3d.position.set(
                tx - 0.5 * tileScale,
								-ty + 0.5 * tileScale,
                elevY
            );
						statsIndicator3d.visible = true;
            render();
        },
        hideIndicator: () => {
            statsIndicator3d.visible = false;
            render();
        },
        // Releases the WebGL context and the window listener so navigating between
        // hike posts (which doesn't remount this component) doesn't leak either.
        destroy: () => {
            window.removeEventListener('resize', onResize);
            controls.dispose();
            markers?.dispose();
            const disposeMesh = (obj: THREE.Object3D) => {
                if (!(obj instanceof THREE.Mesh)) return;
                obj.geometry?.dispose();
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                for (const material of materials) {
                    for (const value of Object.values(material)) {
                        if (value instanceof THREE.Texture) value.dispose();
                    }
                    material.dispose();
                }
            };
            scene.traverse(disposeMesh);
            depthScene.traverse(disposeMesh);
            renderer.dispose();
            if (renderer.domElement.parentElement === container) {
                container.removeChild(renderer.domElement);
            }
        },
    };
}
