import type { Lang } from '$lib/i18n/languages';
import type { PresentationController } from './controller';
export type { Lang };
export type Theme = 'light' | 'dark';
export type Localized<T = string> = { en: T } & Partial<Record<Lang, T>>;
export type Direction = 'forward' | 'backward';
export interface Env { lang: Lang; theme: Theme; reducedMotion: boolean; }

export interface StepHandle { finish(): void; reverse?(): StepHandle; finished: Promise<unknown>; }
export type StepResult = StepHandle | Promise<unknown> | void;

export interface SlideContext extends Env {
	root: HTMLElement; isThumbnail: boolean; signal: AbortSignal;
	t(value: string | Localized): string;
	color(name: 'fg' | 'bg' | 'muted' | 'accent' | 'accent2' | 'dim'): string;
	claimInput(el: Element, kinds: ('keys' | 'drag')[]): void;
}
export interface StateDef { name?: string; label?: string | Localized; }
export interface SlideDef {
	name?: string; label?: string | Localized;
	states?: number | StateDef[];               // default 1
	thumbnail?: 'live' | 'image' | 'label';      // default 'live'
	thumbnails?: string[] | ((ctx: SlideContext, state: number) => string | Promise<string>);
	html?: string;
	mount?(ctx: SlideContext): void | (() => void);
	snap?(ctx: SlideContext, state: number): void;
	step?(ctx: SlideContext, from: number, to: number): StepResult;
	enter?(ctx: SlideContext, state: number, direction: Direction, animate: boolean): StepResult;
	leave?(ctx: SlideContext): void;
	finish?(ctx: SlideContext): void;
	update?(ctx: SlideContext, env: Env): void;
	unmount?(ctx: SlideContext): void;
}
export interface PresentationDef { name?: string; slides: SlideDef[]; }

export interface NormalizedSlide { def: SlideDef; name?: string; label?: string | Localized; states: StateDef[]; }
export interface NormalizedPresentation { name: string; slides: NormalizedSlide[]; }
export interface Position { slide: number; state: number; }
export interface PositionRef { slide: number | string; state?: number | string; }   // numbers 0-based here

/** The external API, set as `presentation` on the frame element (which also carries `data-presentation`). */
export type PresentationApi = Pick<
	PresentationController,
	'next' | 'prev' | 'first' | 'last' | 'goTo' | 'setLanguage' | 'setTheme' | 'on'
> & {
	readonly position: PresentationController['position'];
	toggleGrid(): void;
	toggleFullscreen(): void;
};
