import * as THREE from 'three';
import { demHeightGlsl } from '$lib/hikes/meshline/dem-height';

/**
 * The hero map's terrain: a heightmap-displaced plane drawn as contour lines
 * only. Drawn twice - first `depthOnly` (no colour), so hills hide the lines
 * behind them while the surface itself stays transparent, then as lines.
 */
export interface ContourUniforms {
	[name: string]: THREE.IUniform;
	tHeight: { value: THREE.Texture };
	/** Height (m) at scene y = 0. */
	uMinEle: { value: number };
	/** Scene units per metre of height, vertical exaggeration included. */
	uVScale: { value: number };
	/** Metres between contour lines; every 5th is an index line. */
	uInterval: { value: number };
	/** Lines above this height (m) aren't drawn yet: the entrance animation. */
	uReveal: { value: number };
	uColor: { value: THREE.Color };
	uOpacity: { value: number };
}

/** uReveal when everything is shown: above any terrain, and finite for uniform1f. */
export const NO_REVEAL = 1e9;

export function createContourUniforms(texture: THREE.Texture, minEle: number, vScale: number, interval: number): ContourUniforms {
	return {
		tHeight: { value: texture },
		uMinEle: { value: minEle },
		uVScale: { value: vScale },
		uInterval: { value: interval },
		uReveal: { value: NO_REVEAL },
		uColor: { value: new THREE.Color(0x111827) },
		uOpacity: { value: 0.5 }
	};
}

const vertexShader = /* glsl */ `
	uniform sampler2D tHeight;
	uniform float uMinEle;
	uniform float uVScale;
	out float vHeight;
	${demHeightGlsl}
	void main() {
		float h = demHeight(tHeight, uv);
		vHeight = h;
		vec3 p = position;
		p.y += (h - uMinEle) * uVScale;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
	}
`;

const fragmentShader = /* glsl */ `
	uniform vec3 uColor;
	uniform float uOpacity;
	uniform float uInterval;
	uniform float uReveal;
	in float vHeight;
	void main() {
		if (vHeight > uReveal) discard;
		float f = vHeight / uInterval;
		// Distance to the nearest line, in screen pixels.
		float d = abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1e-4);
		float isIndex = mod(floor(f + 0.5), 5.0) < 0.5 ? 1.0 : 0.0;
		float halfWidth = mix(0.5, 1.0, isIndex);
		float a = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, d);
		if (a < 0.01) discard;
		gl_FragColor = vec4(uColor, a * uOpacity * mix(0.6, 1.0, isIndex));
		#include <colorspace_fragment>
	}
`;

export class ContourMaterial extends THREE.ShaderMaterial {
	constructor(uniforms: ContourUniforms, depthOnly = false) {
		super({
			uniforms,
			vertexShader,
			fragmentShader: depthOnly ? 'void main() { gl_FragColor = vec4(0.0); }' : fragmentShader,
			colorWrite: !depthOnly,
			depthWrite: depthOnly,
			depthTest: true,
			depthFunc: THREE.LessEqualDepth,
			transparent: !depthOnly
		});
	}
}
