import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoKey, swallowNavSpaceKeyup } from './photo-keys';

const t = (tag: string, extra: Partial<{ isContentEditable: boolean; type: string }> = {}) => ({ tagName: tag, isContentEditable: false, ...extra });

test('keys typed into a field, a select or an editable element are ignored', () => {
	for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
		assert.equal(photoKey({ key: 'ArrowRight' }, t(tag)), null, tag);
		assert.equal(photoKey({ key: ' ' }, t(tag)), null, tag);
	}
	assert.equal(photoKey({ key: 'ArrowUp' }, t('DIV', { isContentEditable: true })), null);
	assert.deepEqual(photoKey({ key: 'ArrowUp' }, null), { kind: 'burst', delta: -1 });
});

test('Space on a photo navigation button (burst grid, filmstrip) selects instead of re-clicking it', () => {
	const nav = { tagName: 'BUTTON', isContentEditable: false, dataset: { photoNav: '' } };
	assert.deepEqual(photoKey({ key: ' ' }, nav), { kind: 'toggle' });
	assert.deepEqual(photoKey({ key: 'ArrowDown' }, nav), { kind: 'burst', delta: 1 });
	// an ordinary button keeps its Space; arrows still navigate from it
	assert.equal(photoKey({ key: ' ' }, { tagName: 'BUTTON', isContentEditable: false, dataset: {} }), null);
	assert.deepEqual(photoKey({ key: 'ArrowRight' }, t('BUTTON')), { kind: 'item', delta: 1 });
});

test('Space keyup on a photo nav button is swallowed (Firefox clicks buttons on Space keyup)', () => {
	const nav = { tagName: 'BUTTON', dataset: { photoNav: '' } };
	assert.equal(swallowNavSpaceKeyup({ key: ' ' }, nav), true);
	assert.equal(swallowNavSpaceKeyup({ key: 'Spacebar' }, nav), true);
	assert.equal(swallowNavSpaceKeyup({ key: 'Enter' }, nav), false);
	assert.equal(swallowNavSpaceKeyup({ key: ' ', shiftKey: true }, nav), false);
	// an ordinary button keeps its Space click
	assert.equal(swallowNavSpaceKeyup({ key: ' ' }, { tagName: 'BUTTON', dataset: {} }), false);
	assert.equal(swallowNavSpaceKeyup({ key: ' ' }, { tagName: 'DIV', dataset: { photoNav: '' } }), false);
	assert.equal(swallowNavSpaceKeyup({ key: ' ' }, null), false);
});
