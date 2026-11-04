import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailsFields } from './fields';

test('the Details tab lists no map fields', () => {
	const ids = detailsFields().map((f) => f.id);
	assert.ok(ids.length > 0);
	assert.deepEqual(ids.filter((id) => id.startsWith('map.')), []);
	assert.ok(detailsFields().every((f) => ['text', 'textarea', 'date', 'chips'].includes(f.kind)));
	assert.ok(ids.includes('post.tags'));
});
