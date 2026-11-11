// Slides for the GPU databases paper post (gpu-paper-slides.md): main talk, then the two backup slides.
// Embedded as `![…](/images/blog/lingodb-gpu/presentation/index.js "presentation")`.
import title from './slides/title.js';
import why from './slides/why.js';
import landscape from './slides/landscape.js';
import models from './slides/models.js';
import scope from './slides/scope.js';
import challenges from './slides/challenges.js';
import coreIdea from './slides/core-idea.js';
import sync from './slides/sync.js';
import aggregation from './slides/aggregation.js';
import lingodb from './slides/lingodb.js';
import practical from './slides/practical.js';
import performant from './slides/performant.js';
import portable from './slides/portable.js';
import conclusion from './slides/conclusion.js';
import futureWork from './slides/future-work.js';
import backupAggregation from './slides/backup-aggregation.js';
import backupGpu from './slides/backup-gpu.js';

/** @type {import('../../../../../src/lib/presentation/types').PresentationDef} */
export default {
	name: 'lingodb-gpu',
	slides: [title, why, landscape, models, scope, challenges, coreIdea, sync, aggregation, lingodb, practical, performant, portable, conclusion, futureWork, backupAggregation, backupGpu]
};
