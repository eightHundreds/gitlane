import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../dist/cli.js';

describe('CLI args', () => {
	it('parses repo, port, host, and --no-open', () => {
		const parsed = parseCliArgs(['/tmp/repo', '--port', '4000', '--host', '127.0.0.1', '--no-open']);
		assert.equal(parsed.repo, '/tmp/repo');
		assert.equal(parsed.port, 4000);
		assert.equal(parsed.host, '127.0.0.1');
		assert.equal(parsed.openBrowser, false);
		assert.equal(parsed.help, false);
	});

	it('returns help for -h', () => {
		assert.equal(parseCliArgs(['-h']).help, true);
	});
});
