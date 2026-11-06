// Demo presentation for the markdown test post: one slide per content technique (HTML + anime.js,
// SVG + anime.js timeline, d3, three.js). Embedded as `![…](/images/blog/markdown-test/presentation/index.js "presentation")`.
import text from './slides/text.js';
import diagram from './slides/diagram.js';
import bars from './slides/bars.js';
import scene from './slides/scene.js';

/** @type {import('../../../../../src/lib/presentation/types').PresentationDef} */
export default { name: 'demo', slides: [text, diagram, bars, scene] };
