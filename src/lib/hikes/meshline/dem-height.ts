/**
 * Terrain height from a Mapbox Terrain-RGB DEM tile, shared by every shader
 * that lifts geometry onto the terrain (tiles and the route line), so they all
 * agree on the surface.
 *
 * The tiles are 514px: the tile's 512px plus a 1px buffer copied from each
 * neighbour. `uv` spans the tile itself, so the buffer is skipped and inner
 * pixel centres sit at (j + 0.5) / 512 - which also puts a tile's edge exactly
 * halfway into its buffer, where both neighbouring tiles sample the same height.
 * Bilinear filtering is done by hand on decoded heights: letting the GPU filter
 * the encoded RGB would blend across byte carries.
 *
 * scripts/matches/terrain.py mirrors this (plus the 64-segment tile mesh) to
 * precompute marker heights - keep the two in step.
 */
export const DEM_BUFFER_PX = 1;

export const demHeightGlsl = /* glsl */ `
	float decodeDemTexel(vec4 texel) {
		vec3 bytes = floor(texel.rgb * 255.0 + 0.5);
		return -10000.0 + (bytes.r * 65536.0 + bytes.g * 256.0 + bytes.b) * 0.1;
	}

	// Height in metres at tile-space uv (0..1, v up, as three.js uploads with flipY).
	float demHeight(sampler2D dem, vec2 uv) {
		const int demBuffer = ${DEM_BUFFER_PX};
		ivec2 size = textureSize(dem, 0);
		// 1x1 fallback textures (see makeAltitudeFallback) carry a single height.
		if (size.x <= 2 * demBuffer || size.y <= 2 * demBuffer) return decodeDemTexel(texelFetch(dem, ivec2(0), 0));
		vec2 p = clamp(uv, 0.0, 1.0) * vec2(size - 2 * demBuffer) - 0.5 + float(demBuffer);
		ivec2 p0 = ivec2(floor(p));
		vec2 f = p - vec2(p0);
		ivec2 hi = size - 1;
		float h00 = decodeDemTexel(texelFetch(dem, clamp(p0, ivec2(0), hi), 0));
		float h10 = decodeDemTexel(texelFetch(dem, clamp(p0 + ivec2(1, 0), ivec2(0), hi), 0));
		float h01 = decodeDemTexel(texelFetch(dem, clamp(p0 + ivec2(0, 1), ivec2(0), hi), 0));
		float h11 = decodeDemTexel(texelFetch(dem, clamp(p0 + ivec2(1, 1), ivec2(0), hi), 0));
		return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
	}
`;
