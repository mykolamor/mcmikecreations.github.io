// Shapes the Photos tab reads from the server (see server/photo-sources.ts, server/photo-ops.ts, server/image-match.ts).
export type Asset = { id: string; fileName: string; takenLocal: string; width: number; height: number; lat?: number; lon?: number };
export type Burst = { id: string; assets: Asset[] };
export type Album = { id: string; name: string };
/** `query`: the smart-search text a place doc's candidates came from; `window` ends are '' when a place doc searched all dates. */
export type Candidates = { album: Album | null; albums: Album[]; window: { from: string; to: string }; bursts: Burst[]; inPost: Record<string, string>; query?: string };
export type PostPhoto = {
	key: string;
	href: string;
	assetId: string | null;
	inText: boolean;
	pins: number;
	w?: number;
	h?: number;
	lat?: number;
	lon?: number;
	taken?: string;
	located?: string;
	alt?: string;
};
export type ImmichError = { key: string; message: string };
/** What any photo write may answer; the tab turns the optional parts into notices. */
export type WriteResult = {
	version: string;
	key?: string;
	stamped?: boolean;
	previous?: string | null;
	caption?: string;
	immichErrors?: ImmichError[];
	skipped?: string[];
	note?: string;
	/** Added, but the Immich link could not be saved. */
	linkError?: string;
};
/** Runs a write with the tab's busy flag, error line and notices; resolves undefined when it failed. */
export type Act = <T extends WriteResult>(fn: () => Promise<T>) => Promise<T | undefined>;

export const thumbUrl = (id: string, size: 'thumbnail' | 'preview' = 'thumbnail') => `/api/immich/thumb/${encodeURIComponent(id)}?size=${size}`;

export type FixMode = 'time' | 'location' | 'alt' | 'find';
