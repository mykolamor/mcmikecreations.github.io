import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, run } from './index';
import { recorder } from './test-output';

test('parseArgs splits command, flags and positionals', () => {
	const a = parseArgs(['metrics', '2024-01-01-foo', '--missing-only', '--dry-run', 'bar.md']);
	assert.equal(a.command, 'metrics');
	assert.deepEqual([...a.flags].sort(), ['dry-run', 'missing-only']);
	assert.deepEqual(a.positional, ['2024-01-01-foo', 'bar.md']);
	const none = parseArgs([]);
	assert.equal(none.command, null);
	assert.equal(none.flags.size, 0);
	assert.deepEqual(none.positional, []);
	assert.deepEqual([...parseArgs(['images', '--refresh']).flags], ['refresh']);
});

test('an unknown command or flag exits 2 and runs nothing', async () => {
	const out = recorder();
	assert.equal(await run(['nope'], '/nonexistent', out), 2);
	assert.match(out.warnings.join('\n'), /Unknown command: nope/);
	assert.deepEqual(out.summaries, []);
	const typo = recorder();
	assert.equal(await run(['metrics', '--dry-rn'], '/nonexistent', typo), 2);
	assert.match(typo.warnings.join('\n'), /Unknown flag for metrics: --dry-rn/);
});
