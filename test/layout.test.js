import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../dist/layout.js';
import { layoutHasParentEdge } from './helpers.js';

describe('layoutGraph (pure DAG)', () => {
	it('assigns multiple lanes and parent edges for a branch+merge graph', () => {
		const commits = [
			{ hash: 'm', parents: ['t', 'f'] },
			{ hash: 't', parents: ['i'] },
			{ hash: 'f', parents: ['i'] },
			{ hash: 'i', parents: [] }
		];
		const layout = layoutGraph(commits, { head: 'm' });
		assert.ok(layout.laneCount > 1);
		assert.equal(layout.vertices.length, 4);
		assert.ok(layout.vertices[0].isCurrent);
		assert.ok(layoutHasParentEdge(layout, 0, 1));
		assert.ok(layoutHasParentEdge(layout, 0, 2));
		assert.ok(layoutHasParentEdge(layout, 1, 3));
		assert.ok(layoutHasParentEdge(layout, 2, 3));
		assert.ok(layout.branches.some((b) => b.lines.length > 0));
	});

	it('places a stash on a fresh lane instead of looking up its hash', () => {
		const layout = layoutGraph(
			[
				{ hash: 's', parents: ['b'], stash: { selector: 'stash@{0}', baseHash: 'b' } },
				{ hash: 'b', parents: ['a'] },
				{ hash: 'a', parents: [] }
			],
			{ head: 'b' }
		);
		assert.equal(layout.vertices[0].isStash, true);
		assert.equal(layout.vertices[1].isStash, false);
		assert.ok(layoutHasParentEdge(layout, 0, 1));
	});
});
