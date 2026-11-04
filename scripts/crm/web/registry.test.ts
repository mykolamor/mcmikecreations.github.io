import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTabs, leaveQuestion, registerTab, setLeaveQuestion } from './registry';

const A = (() => null) as never;
const B = (() => null) as never;

test('one tab id can have its own component per item kind; re-registering a kind replaces only that kind', () => {
	registerTab({ id: 'details', label: 'Details & files', order: 10, component: A, kinds: ['hike'] });
	registerTab({ id: 'details', label: 'Details', order: 10, component: B, kinds: ['place'] });
	registerTab({ id: 'photos', label: 'Photos', order: 30, component: A, kinds: ['hike', 'place'] });
	assert.deepEqual(getTabs('hike').map((t) => [t.id, t.label]), [['details', 'Details & files'], ['photos', 'Photos']]);
	assert.deepEqual(getTabs('place').map((t) => [t.id, t.label]), [['details', 'Details'], ['photos', 'Photos']]);
	// a later plan replacing the hike's photos tab leaves the place's alone
	registerTab({ id: 'photos', label: 'Photos 2', order: 30, component: B, kinds: ['hike'] });
	assert.deepEqual(getTabs('hike').map((t) => t.label), ['Details & files', 'Photos 2']);
	assert.deepEqual(getTabs('place').map((t) => t.label), ['Details', 'Photos']);
});

test('a tab can ask before it is left; unregistering, or another tab registering, drops its question', () => {
	assert.equal(leaveQuestion(), null);
	let busy = true;
	const off = setLeaveQuestion(() => (busy ? 'Cancel the video upload?' : null));
	assert.equal(leaveQuestion(), 'Cancel the video upload?');
	busy = false;
	assert.equal(leaveQuestion(), null);
	busy = true;
	off();
	assert.equal(leaveQuestion(), null);
	// an old tab's late unregister leaves the newer tab's question alone
	const offA = setLeaveQuestion(() => 'A?');
	setLeaveQuestion(() => 'B?');
	offA();
	assert.equal(leaveQuestion(), 'B?');
});
