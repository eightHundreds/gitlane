import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFileChangeTree, filesToTreeHtml } from '../dist/filetree.js';

const nestedChanges = [
	{ newFilePath: 'src/a.js', type: 'M', additions: 1, deletions: 1 },
	{ newFilePath: 'src/nested/b.js', type: 'A', additions: 2, deletions: 0 },
	{ newFilePath: 'README.md', type: 'M', additions: 0, deletions: 1 }
];

describe('commit-details file tree grouping', () => {
	it('buildFileChangeTree groups folders and uses basenames', () => {
		const tree = buildFileChangeTree(nestedChanges);
		assert.deepEqual(
			tree.map((n) => [n.kind, n.name]),
			[
				['dir', 'src'],
				['file', 'README.md']
			]
		);
		const src = tree.find((n) => n.kind === 'dir' && n.name === 'src');
		assert.ok(src);
		assert.deepEqual(
			src.children.map((n) => [n.kind, n.name, n.kind === 'file' ? n.depth : n.depth]),
			[
				['dir', 'nested', 1],
				['file', 'a.js', 1]
			]
		);
		const nested = src.children.find((n) => n.kind === 'dir' && n.name === 'nested');
		assert.equal(nested.children.length, 1);
		assert.equal(nested.children[0].kind, 'file');
		assert.equal(nested.children[0].name, 'b.js');
		assert.equal(nested.children[0].label, 'b.js');
		assert.equal(nested.children[0].depth, 2);
		assert.equal(nested.children[0].file.type, 'A');
		assert.ok(tree.every((n) => n.kind !== 'file' || !n.name.includes('/')));
	});

	it('buildFileChangeTree rename labels stay on the destination leaf', () => {
		const tree = buildFileChangeTree([
			{ newFilePath: 'src/new.js', oldFilePath: 'src/old.js', type: 'R', additions: 0, deletions: 0 }
		]);
		const src = tree.find((n) => n.kind === 'dir' && n.name === 'src');
		assert.ok(src);
		const leaf = src.children.find((n) => n.kind === 'file');
		assert.equal(leaf.name, 'new.js');
		assert.equal(leaf.label, 'old.js → new.js');
		assert.equal(leaf.file.type, 'R');
	});

	it('renders indented folder names and basenames, not full paths', () => {
		const html = filesToTreeHtml(nestedChanges);
		assert.match(html, /class="file-tree"/);
		assert.match(html, /class="file-row dir"[^>]*>[\s\S]*<span class="tree-name">src<\/span>/);
		assert.match(html, /<span class="tree-name">nested<\/span>/);
		assert.match(html, /class="tree-name">a\.js</);
		assert.match(html, /class="tree-name">b\.js</);
		assert.match(html, /class="tree-name">README\.md</);
		assert.match(html, /--tree-depth:1/);
		assert.match(html, /file-type A/);
		assert.doesNotMatch(html, />src\/nested\/b\.js</);
		assert.doesNotMatch(html, />src\/a\.js</);
	});

	it('keeps rename labels on the destination folder leaf', () => {
		const html = filesToTreeHtml([
			{ newFilePath: 'src/new.js', oldFilePath: 'src/old.js', type: 'R', additions: 0, deletions: 0 }
		]);
		assert.match(html, /old\.js → new\.js/);
		assert.match(html, /class="file-tree"/);
	});
});

