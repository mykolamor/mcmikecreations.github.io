// The LingoDB/MLIR compilation diagram (deck slide "Implementation in LingoDB") as a static post figure.
// The declared width (625) is wider than the drawing canvas (610): the runtime-calls curve bulges past it.
// Embedded in the post as `![caption](/images/blog/lingodb-gpu/embeds/lowering.js)`.
import { embedFigure } from '../../_kit/index.js';
import { lowering } from '../presentation/figs/lowering.js';

export default embedFigure({ size: { w: 625, h: 610 }, draw: (k, root) => lowering(k, root, 0, 0, () => 'all') });
