<script lang="ts">
	import { onMount } from 'svelte';
	import { animate, createScope, onScroll, stagger } from 'animejs';

	const parallaxStrength = 0.1;
	const syncStrength = 0.95;

	onMount(() => {
		// Browsers with scroll-driven animations run the parallax in CSS (see the styles), off the main thread.
		if (CSS.supports('animation-timeline: scroll()')) return;
		const root = document.getElementById('hero')!;
		const text = root.querySelector<HTMLDivElement>('.parallax-text')!;
		const layer2 = document.querySelector<HTMLDivElement>('.hero-layer2')!
		const layer3 = document.querySelector<HTMLDivElement>('.hero-layer3')!
		const layer4 = document.querySelector<HTMLDivElement>('.hero-layer4')!
		const layer5 = document.querySelector<HTMLDivElement>('.hero-layer5')!
		const layer6 = document.querySelector<HTMLDivElement>('.hero-layer6')!
		function setupTextAnimation(syncStrength: number | boolean) {
			const scope = createScope({
				root: root,
				mediaQueries: {
					reducedMotion: '(prefers-reduced-motion)',
				}
			}).add(self => {
				const { reducedMotion } = self!.matches;
				animate(text, {
					translateY: [0, window.innerHeight],
					composition: 'replace',
					autoplay: onScroll({
						target: root,
						sync: reducedMotion ? true : syncStrength,
						enter: 'top top',
						leave: 'top bottom*=1.5',
						debug: false,
					}),
				});
				animate([layer2, layer3, layer4, layer5, layer6], {
					translateY: [0, stagger(window.innerHeight * parallaxStrength)],
					composition: 'replace',
					autoplay: onScroll({
						target: root,
						sync: reducedMotion ? true : syncStrength,
						enter: 'top top',
						leave: 'top bottom*=1.5',
						debug: false,
					}),
				});
			});
		}

		requestAnimationFrame(() => {
			window.addEventListener('resize', () => {
				setupTextAnimation(syncStrength);
			});
			setupTextAnimation(syncStrength);
		});
	});
</script>

<div class="w-full h-[100vh] absolute top-0 left-0">
	<div id="hero" class="max-w-full max-h-full h-[100vh] relative overflow-hidden">
		<div class="parallax-layer hero-layer1"></div>
		<div class="parallax-layer hero-layer2" style="--layer: 0"></div>
		<div class="parallax-layer hero-layer3" style="--layer: 1"></div>
		<div class="parallax-layer hero-layer4" style="--layer: 2"></div>
		<div class="parallax-layer hero-layer5" style="--layer: 3"></div>
		<div class="parallax-layer hero-layer6" style="--layer: 4"></div>
		<h1 class="absolute z-10 text-white drop-shadow-xl text-[8rem] left-10 top-[1rem] pointer-events-none parallax-text">Hikes</h1>
	</div>
</div>
<div class="h-[100vh] w-full"></div>

<style>
    @reference "../../../app.css";
    .parallax-layer {
        @apply absolute top-0 left-0 w-full h-full;

        background-repeat: no-repeat;
        background-size: cover;
        background-position: center;
        pointer-events: none;
    }

    .parallax-text {
        transition: transform 0.1s linear;
    }

    /* Mirrors the anime.js fallback: over the first 150vh of scroll, out(2) easing,
       the text moves down 100vh and each layer 10vh more than the one below it. */
    @supports (animation-timeline: scroll()) {
        .parallax-text,
        .hero-layer2, .hero-layer3, .hero-layer4, .hero-layer5, .hero-layer6 {
            animation: hero-parallax cubic-bezier(0.333, 0.667, 0.667, 1) both;
            animation-timeline: scroll(root);
            animation-range: 0 150vh;
        }

        .parallax-text {
            --parallax-to: 100vh;
            transition: none;
        }

        .hero-layer2, .hero-layer3, .hero-layer4, .hero-layer5, .hero-layer6 {
            --parallax-to: calc(var(--layer) * 10vh);
        }

        @keyframes hero-parallax {
            from { transform: translateY(0); }
            to { transform: translateY(var(--parallax-to)); }
        }
    }

    .hero-layer1 {
        background-image: url("/images/hikes/hero/hike_poster_4_bg_2.png");
        transform: translateY(0);
        z-index: 1;
    }

    .hero-layer2 {
        background-image: url("/images/hikes/hero/hike_poster_4.png");
        transform: translateY(0);
        z-index: 2;
    }

    .hero-layer3 {
        background-image: url("/images/hikes/hero/hike_poster_3.png");
        transform: translateY(0);
        z-index: 3;
    }

    .hero-layer4 {
        background-image: url("/images/hikes/hero/hike_poster_2.png");
        transform: translateY(0);
        z-index: 4;
    }

    .hero-layer5 {
        background-image: url("/images/hikes/hero/hike_poster_0.png");
        transform: translateY(0);
        z-index: 5;
    }

    .hero-layer6 {
        background-image: url("/images/hikes/hero/hike_poster_1.png");
        transform: translateY(0);
        z-index: 6;
    }
</style>
