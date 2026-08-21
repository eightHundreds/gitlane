import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filesToTreeHtml } from '../web/filetree.js';

describe('commit-details file tree grouping', () => {
	it('renders folder rows and nested files from the shipped grouper', () => {
		const html = filesToTreeHtml([
			{ newFilePath: 'src/a.js', type: 'M', additions: 1, deletions: 1 },
			{ newFilePath: 'src/nested/b.js', type: 'A', additions: 2, deletions: 0 },
			{ newFilePath: 'README.md', type: 'M', additions: 0, deletions: 1 }
		]);
		assert.match(html, /class="file-row dir">src\//);
		assert.match(html, /class="file-row dir">src\/nested\//);
		assert.match(html, /data-i="0"/);
		assert.match(html, /src\/a\.js/);
		assert.match(html, /src\/nested\/b\.js/);
		assert.match(html, /README\.md/);
		assert.match(html, /file-type A/);
	});
});
