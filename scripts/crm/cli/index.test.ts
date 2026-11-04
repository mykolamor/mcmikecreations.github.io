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

test('unknown command exits 2 with usage', async () => {
	const out = recorder();
	assert.equal(await run(['nope'], '/nonexistent', out), 2);
	const text = out.warnings.join('\n');
	assert.match(text, /Unknown command: nope/);
	assert.match(text, /Usage: pnpm crm/);
	assert.match(text, /metrics/);
	assert.deepEqual(out.summaries, []);
});

test('an unknown flag exits 2 and runs nothing', async () => {
	const out = recorder();
	assert.equal(await run(['metrics', '--dry-rn'], '/nonexistent', out), 2);
	assert.match(out.warnings.join('\n'), /Unknown flag for metrics: --dry-rn/);
});

test('help lists every command with one line each', async () => {
	const out = recorder();
	assert.equal(await run(['help'], '/nonexistent', out), 0);
	assert.match(out.summaries.join('\n'), /^ {2}metrics +\S.*$/m);
	assert.deepEqual(out.warnings, []);
});
