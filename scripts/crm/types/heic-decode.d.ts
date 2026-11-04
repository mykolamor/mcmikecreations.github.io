// heic-decode 2.x ships no types. Only the default export (decode the primary image) is used.
declare module 'heic-decode' {
	export type DecodedImage = { width: number; height: number; data: Uint8ClampedArray };
	export default function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<DecodedImage>;
}
