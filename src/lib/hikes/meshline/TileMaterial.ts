import * as THREE from 'three';
import { demHeightGlsl } from '$lib/hikes/meshline/dem-height';

export interface TileMaterialParameters {
	uvFromPosition: boolean;
	includeDisplacement: boolean;
	colorFromUv: boolean;
	diffuseTexture: THREE.Texture;
	displacementTexture: THREE.Texture;
	tOffset: number;
	tTileSize: number;
	tScale: number;
	depthTest?: boolean;
	/** Write packed fragment depth instead of colour (the 3D map's marker occlusion pass). */
	outputDepth?: boolean;
}

export class TileMaterial extends THREE.ShaderMaterial {
	constructor(parameters: TileMaterialParameters) {
		const vertexShader = `
				uniform sampler2D tDisplacement;
				uniform float tScale;
				uniform float tTileSize;
				uniform float tOffset;
				out vec2 tuv;
				${demHeightGlsl}
				void main()	{
				  //tuv = uv;
					tuv = ${parameters.uvFromPosition ? 'clamp(position.xy / tTileSize + vec2(0.5, 0.5), 0.0, 1.0)' : 'uv'};
					// height in meters
					float height = demHeight(tDisplacement, tuv);
					gl_Position = projectionMatrix
						* modelViewMatrix
						* vec4(position.x, position.y, position.z + ${parameters.includeDisplacement ? 'height' : '0.0'} * tScale + tOffset, 1.0)
						+ vec4(0.0, 0.0, -tOffset * 0.1, 0.0);
				}
				`;
		const fragmentShader = `
				#include <packing>
				uniform sampler2D tDiffuse;
				in vec2 tuv;
				void main() {
					gl_FragColor = ${parameters.outputDepth
						? 'packDepthToRGBA(gl_FragCoord.z)'
						: parameters.colorFromUv ? 'vec4(tuv.x, tuv.y, 0.0, 1.0)' : 'vec4(texture2D(tDiffuse, tuv))'};
				}
				`;

		super({
			uniforms: {
				tScale: { value: parameters.tScale },
				tTileSize: { value: parameters.tTileSize },
				tOffset: { value: parameters.tOffset },
				tDisplacement: { value: parameters.displacementTexture },
				tDiffuse: { value: parameters.diffuseTexture }
			},
			depthTest: parameters.depthTest ?? true,
			vertexShader,
			fragmentShader,
		});
	}
}