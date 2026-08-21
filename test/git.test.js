import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	UNCOMMITTED,
	getCommitComparison,
	getCommitDetails,
	getCommits,
	getFileAtRevision,
	getFileDiffSides,
	layoutGraph
} from '../src/git.js';
import { runAction } from '../src/actions.js';
import { layoutGraph as layoutGraphDirect } from '../src/layout.js';
import {
	createEmptyRepo,
	createFixtureRepo,
	gitRaw,
	gitRawFull,
	layoutHasParentEdge,
	parseNameStatus
} from './helpers.js';

describe('git read/write + graph layout on a real repository', () => {
	let fx;

	before(async () => {
		fx = await createFixtureRepo();
	});

	after(async () => {
		if (fx?.repo) await fs.rm(fx.repo, { recursive: true, force: true });
	});

	it('loads commits with fixture hashes, subjects, refs, and uncommitted node', async () => {
		const oracleLog = await gitRawFull(fx.repo, ['log', '--format=%H %s', '--date-order', '--all']);
		const data = await getCommits(fx.repo);

		const byHash = Object.fromEntries(data.commits.filter((c) => c.hash !== UNCOMMITTED).map((c) => [c.hash, c]));

		assert.equal(byHash[fx.hashes.merge].message, fx.subjects.merge);
		assert.equal(byHash[fx.hashes.feature].message, fx.subjects.feature);
		assert.equal(byHash[fx.hashes.initial].message, fx.subjects.initial);
		assert.equal(byHash[fx.hashes.mainTip].message, fx.subjects.mainTip);

		assert.ok(oracleLog.includes(fx.hashes.merge));
		assert.ok(oracleLog.includes(fx.subjects.merge));

		const mergeNode = byHash[fx.hashes.merge];
		assert.ok(mergeNode.heads.includes('main'), 'main head on merge commit');
		assert.ok(
			mergeNode.tags.some((t) => t.name === 'v1.0'),
			'tag v1.0 on merge commit'
		);
		assert.ok(byHash[fx.hashes.feature].heads.includes('feature'));
		assert.ok(
			mergeNode.remotes.some((r) => r.name === 'origin/main'),
			'remote origin/main attached to merge commit'
		);

		const uncommitted = data.commits.find((c) => c.hash === UNCOMMITTED);
		assert.ok(uncommitted, 'uncommitted node present when dirty');
		assert.deepEqual(uncommitted.parents, [fx.hashes.merge]);
		assert.equal(data.head, fx.hashes.merge);
		assert.equal(data.branch, 'main');
	});

	it('omits uncommitted node iff the working tree is clean', async () => {
		const dirtyPath = path.join(fx.repo, 'uncommitted.txt');
		assert.ok((await getCommits(fx.repo)).commits.some((c) => c.hash === UNCOMMITTED));
		await fs.unlink(dirtyPath);
		assert.ok(!(await getCommits(fx.repo)).commits.some((c) => c.hash === UNCOMMITTED));
		await fs.writeFile(dirtyPath, fx.files.uncommitted);
		assert.ok((await getCommits(fx.repo)).commits.some((c) => c.hash === UNCOMMITTED));
	});

	it('layout of the branch+merge DAG has parent edges and more than one lane', async () => {
		const data = await getCommits(fx.repo);
		assert.equal(layoutGraphDirect, layoutGraph);
		const layout = data.layout;
		assert.ok(layout.laneCount > 1, `expected multiple lanes, got ${layout.laneCount}`);
		assert.ok(layout.branches.length >= 2);
		assert.ok(layout.branches.some((b) => b.lines.length > 0));

		const lookup = Object.fromEntries(data.commits.map((c, i) => [c.hash, i]));
		for (const commit of data.commits) {
			for (const parent of commit.parents) {
				if (typeof lookup[parent] !== 'number') continue;
				assert.ok(
					layoutHasParentEdge(layout, lookup[commit.hash], lookup[parent]),
					`missing parent edge ${commit.hash.slice(0, 8)} -> ${parent.slice(0, 8)}`
				);
			}
		}

		const merge = data.commits.find((c) => c.hash === fx.hashes.merge);
		assert.equal(merge.parents.length, 2);
	});

	it('commit details file list matches git diff --name-status of that revision', async () => {
		const details = await getCommitDetails(fx.repo, fx.hashes.feature);
		const oracleHash = (await gitRaw(fx.repo, ['rev-parse', fx.hashes.feature])).trim();
		const oracleParents = (await gitRaw(fx.repo, ['log', '-1', '--format=%P', fx.hashes.feature]))
			.trim()
			.split(' ')
			.filter(Boolean);
		assert.equal(details.hash, fx.hashes.feature);
		assert.equal(details.hash, oracleHash);
		assert.equal(details.hash.length, 40);
		assert.deepEqual(details.parents, oracleParents);
		assert.equal(details.author, 'Fixture User');
		assert.equal(details.email, 'fixture@example.com');
		assert.equal(details.committer, 'Fixture User');
		assert.equal(details.committerEmail, 'fixture@example.com');
		assert.match(details.body, /add feature work/);

		const oracle = parseNameStatus(
			await gitRawFull(fx.repo, ['diff', '--name-status', `${fx.hashes.feature}^`, fx.hashes.feature])
		);
		const actual = details.fileChanges.map((f) => `${f.type}:${f.newFilePath}`).sort();
		const expected = oracle.map((f) => `${f.type}:${f.newFilePath}`).sort();
		assert.deepEqual(actual, expected);
		assert.ok(actual.some((x) => x.endsWith('feature.txt')));
	});

	it('two-commit comparison matches git diff --name-status', async () => {
		const cmp = await getCommitComparison(fx.repo, fx.hashes.initial, fx.hashes.feature);
		const oracle = parseNameStatus(
			await gitRawFull(fx.repo, ['diff', '--name-status', fx.hashes.initial, fx.hashes.feature])
		);
		assert.deepEqual(
			cmp.fileChanges.map((f) => `${f.type}:${f.newFilePath}`).sort(),
			oracle.map((f) => `${f.type}:${f.newFilePath}`).sort()
		);
	});

	it('file-at-revision equals git show <rev>:<path>; empty for missing add/delete side', async () => {
		const featureReadme = await getFileAtRevision(fx.repo, fx.hashes.feature, 'README.md');
		const oracleReadme = await gitRawFull(fx.repo, ['show', `${fx.hashes.feature}:README.md`]);
		assert.equal(featureReadme, oracleReadme);
		assert.equal(featureReadme, fx.files.readmeFeature);

		const featureTxt = await getFileAtRevision(fx.repo, fx.hashes.feature, 'feature.txt');
		assert.equal(featureTxt, await gitRawFull(fx.repo, ['show', `${fx.hashes.feature}:feature.txt`]));
		assert.equal(featureTxt, fx.files.featureFile);

		const missingBeforeAdd = await getFileAtRevision(fx.repo, fx.hashes.initial, 'feature.txt');
		assert.equal(missingBeforeAdd, '');

		const dirty = await getFileAtRevision(fx.repo, UNCOMMITTED, 'uncommitted.txt');
		assert.equal(dirty, fx.files.uncommitted);
		const missingInHead = await getFileAtRevision(fx.repo, fx.hashes.merge, 'uncommitted.txt');
		assert.equal(missingInHead, '');

		const addSides = await getFileDiffSides(fx.repo, {
			fromHash: fx.hashes.initial,
			toHash: fx.hashes.feature,
			path: 'feature.txt',
			status: 'A'
		});
		assert.equal(addSides.left.content, '');
		assert.equal(addSides.right.content, fx.files.featureFile);

		const delSides = await getFileDiffSides(fx.repo, {
			fromHash: fx.hashes.feature,
			toHash: fx.hashes.initial,
			path: 'feature.txt',
			status: 'D'
		});
		assert.equal(delSides.left.content, fx.files.featureFile);
		assert.equal(delSides.right.content, '');

		await assert.rejects(
			() => getFileAtRevision(fx.repo, 'not-a-real-revision-zzzz', 'README.md'),
			/invalid object name|bad revision|unknown revision|ambiguous argument/i
		);

		const linkPath = path.join(fx.repo, 'outside-link');
		await fs.symlink('/etc/passwd', linkPath);
		const linkText = await getFileAtRevision(fx.repo, UNCOMMITTED, 'outside-link');
		assert.equal(linkText, '/etc/passwd');
		assert.doesNotMatch(linkText, /root:/);
		await fs.unlink(linkPath);
	});

	it('merges a deleted-and-recreated untracked path into one file change', async () => {
		const isolated = await createFixtureRepo();
		try {
			await gitRaw(isolated.repo, ['rm', '-f', 'feature.txt']);
			await fs.writeFile(path.join(isolated.repo, 'feature.txt'), 'untracked again\n');
			const cmp = await getCommitComparison(isolated.repo, isolated.hashes.merge, UNCOMMITTED);
			const rows = cmp.fileChanges.filter(
				(f) => f.newFilePath === 'feature.txt' || f.oldFilePath === 'feature.txt'
			);
			assert.equal(rows.length, 1);
			assert.equal(rows[0].type, 'M');
			const sides = await getFileDiffSides(isolated.repo, {
				fromHash: isolated.hashes.merge,
				toHash: UNCOMMITTED,
				path: 'feature.txt',
				status: 'M'
			});
			assert.equal(sides.left.content, isolated.files.featureFile);
			assert.equal(sides.right.content, 'untracked again\n');
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('loads an empty graph for a valid repo with no commits', async () => {
		const empty = await createEmptyRepo();
		try {
			const data = await getCommits(empty);
			assert.equal(data.commits.length, 0);
			assert.equal(data.head, null);
			assert.equal(data.branch, 'main');
			assert.equal(data.layout.laneCount, 0);
		} finally {
			await fs.rm(empty, { recursive: true, force: true });
		}
	});

	it('still shows other branch history while HEAD is an orphan', async () => {
		const isolated = await createFixtureRepo();
		try {
			await gitRaw(isolated.repo, ['checkout', '--orphan', 'next']);
			const data = await getCommits(isolated.repo);
			const hashes = data.commits.filter((c) => c.hash !== UNCOMMITTED).map((c) => c.hash);
			assert.ok(hashes.includes(isolated.hashes.merge), 'merge commit still visible');
			assert.ok(hashes.includes(isolated.hashes.feature), 'feature history still visible');
			assert.equal(data.branch, 'next');
			assert.equal(data.head, null);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('shows uncommitted changes on an unborn HEAD with working-tree files', async () => {
		const empty = await createEmptyRepo();
		try {
			await fs.writeFile(path.join(empty, 'new.txt'), 'hello unborn\n');
			const data = await getCommits(empty);
			const uncommitted = data.commits.find((c) => c.hash === UNCOMMITTED);
			assert.ok(uncommitted, 'uncommitted node present before first commit');
			assert.deepEqual(uncommitted.parents, []);
			const details = await getCommitDetails(empty, UNCOMMITTED);
			assert.ok(details.fileChanges.some((f) => f.newFilePath === 'new.txt' && (f.type === 'U' || f.type === 'A')));
			const body = await getFileAtRevision(empty, UNCOMMITTED, 'new.txt');
			assert.equal(body, 'hello unborn\n');
		} finally {
			await fs.rm(empty, { recursive: true, force: true });
		}
	});

	it('rejects checkout targets that look like git options', async () => {
		await fs.writeFile(path.join(fx.repo, 'keep-me.txt'), 'keep\n');
		await assert.rejects(() => runAction(fx.repo, 'checkout', { target: '-f' }), /invalid checkout target/);
		const still = await fs.readFile(path.join(fx.repo, 'keep-me.txt'), 'utf8');
		assert.equal(still, 'keep\n');
		await fs.unlink(path.join(fx.repo, 'keep-me.txt'));
	});

	it('duplicate create-branch is rejected and does not move HEAD', async () => {
		const isolated = await createFixtureRepo();
		try {
			const head = (await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim();
			await assert.rejects(
				() => runAction(isolated.repo, 'createBranch', { name: 'main', commitHash: isolated.hashes.merge }),
				/already exists|fatal/i
			);
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim(), head);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('still shows uncommitted changes when HEAD is outside the truncated log', async () => {
		const isolated = await createFixtureRepo();
		try {
			await gitRaw(isolated.repo, ['checkout', 'feature']);
			for (let i = 0; i < 3; i++) {
				await fs.writeFile(path.join(isolated.repo, `ahead-${i}.txt`), `n${i}\n`);
				await gitRaw(isolated.repo, ['add', `ahead-${i}.txt`]);
				await gitRaw(isolated.repo, ['commit', '-m', `ahead ${i}`]);
			}
			await gitRaw(isolated.repo, ['checkout', 'main']);
			await fs.writeFile(path.join(isolated.repo, 'late-dirty.txt'), 'dirty-after-truncate\n');
			const data = await getCommits(isolated.repo, { maxCommits: 2 });
			const hashes = data.commits.map((c) => c.hash);
			assert.ok(hashes.includes(UNCOMMITTED), 'uncommitted node present even if HEAD is truncated');
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('checkout and create-branch mutate the repo and a reload sees the new HEAD/refs', async () => {
		await runAction(fx.repo, 'checkout', { target: 'feature' });
		assert.equal((await gitRaw(fx.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'feature');
		assert.equal((await gitRaw(fx.repo, ['rev-parse', 'HEAD'])).trim(), fx.hashes.feature);
		let data = await getCommits(fx.repo);
		assert.equal(data.branch, 'feature');
		assert.equal(data.head, fx.hashes.feature);

		await runAction(fx.repo, 'checkout', { target: 'main' });
		data = await getCommits(fx.repo);
		assert.equal(data.branch, 'main');
		assert.equal(data.head, fx.hashes.merge);

		await runAction(fx.repo, 'createBranch', { name: 'hotfix', commitHash: fx.hashes.merge });
		const branchRef = (await gitRaw(fx.repo, ['rev-parse', 'refs/heads/hotfix'])).trim();
		assert.equal(branchRef, fx.hashes.merge);
		data = await getCommits(fx.repo);
		const mergeNode = data.commits.find((c) => c.hash === fx.hashes.merge);
		assert.ok(mergeNode.heads.includes('hotfix'), 'reload shows new branch on the commit');
		assert.ok(mergeNode.heads.includes('main'));
	});

	it('lists stashes newest-first after the uncommitted node', async () => {
		const isolated = await createFixtureRepo();
		try {
			await runAction(isolated.repo, 'stash', { message: 'first', includeUntracked: true });
			await fs.writeFile(path.join(isolated.repo, 'second.txt'), 'two\n');
			await runAction(isolated.repo, 'stash', { message: 'second', includeUntracked: true });
			const data = await getCommits(isolated.repo);
			const stashes = data.commits.filter((c) => c.stash);
			assert.ok(stashes.length >= 2);
			assert.equal(stashes[0].stash.selector, 'stash@{0}');
			assert.match(stashes[0].message, /second/);
			assert.equal(stashes[1].stash.selector, 'stash@{1}');
			assert.match(stashes[1].message, /first/);
			assert.equal(
				data.commits.findIndex((c) => c.hash === UNCOMMITTED),
				-1
			);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});
});
