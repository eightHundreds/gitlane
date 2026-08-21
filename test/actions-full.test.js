import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFixtureRepo, gitRaw, gitRawFull } from './helpers.js';
import { getCommits, UNCOMMITTED } from '../src/git.js';
import { runAction } from '../src/actions.js';
import { listenGitGraph } from '../src/server.js';

async function cleanUntrackedFile(repo) {
	await fs.unlink(path.join(repo, 'uncommitted.txt')).catch(() => {});
}

describe('dispatcher coverage for remaining git actions', () => {
	it('checkout and createBranch via runAction change HEAD/refs', async () => {
		const isolated = await createFixtureRepo();
		try {
			await cleanUntrackedFile(isolated.repo);
			await runAction(isolated.repo, 'checkout', { target: 'feature' });
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'feature');
			await runAction(isolated.repo, 'createBranch', {
				name: 'from-action',
				commitHash: isolated.hashes.merge
			});
			assert.equal(
				(await gitRaw(isolated.repo, ['rev-parse', 'refs/heads/from-action'])).trim(),
				isolated.hashes.merge
			);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('rebase replays the current branch onto another tip', async () => {
		const isolated = await createFixtureRepo();
		try {
			await cleanUntrackedFile(isolated.repo);
			await gitRaw(isolated.repo, ['checkout', isolated.hashes.initial]);
			await gitRaw(isolated.repo, ['checkout', '-b', 'onto']);
			await fs.writeFile(path.join(isolated.repo, 'onto.txt'), 'onto base\n');
			await gitRaw(isolated.repo, ['add', 'onto.txt']);
			await gitRaw(isolated.repo, ['commit', '-m', 'onto base']);
			const onto = (await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim();
			await gitRaw(isolated.repo, ['checkout', 'feature']);
			await runAction(isolated.repo, 'rebase', { ref: 'onto' });
			assert.equal(await fs.readFile(path.join(isolated.repo, 'onto.txt'), 'utf8'), 'onto base\n');
			assert.equal(await fs.readFile(path.join(isolated.repo, 'feature.txt'), 'utf8'), isolated.files.featureFile);
			await gitRaw(isolated.repo, ['merge-base', '--is-ancestor', onto, 'HEAD']);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('revert undoes a unique commit on the current branch', async () => {
		const isolated = await createFixtureRepo();
		try {
			await cleanUntrackedFile(isolated.repo);
			await gitRaw(isolated.repo, ['checkout', 'feature']);
			await fs.writeFile(path.join(isolated.repo, 'revert-me.txt'), 'going away\n');
			await gitRaw(isolated.repo, ['add', 'revert-me.txt']);
			await gitRaw(isolated.repo, ['commit', '-m', 'add revert-me']);
			const added = (await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim();
			await runAction(isolated.repo, 'revert', { hash: added });
			await assert.rejects(() => fs.access(path.join(isolated.repo, 'revert-me.txt')), /ENOENT/);
			assert.match(await gitRaw(isolated.repo, ['log', '-1', '--format=%s']), /Revert/);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('dropCommit removes a linear tip from the current branch', async () => {
		const isolated = await createFixtureRepo();
		try {
			await cleanUntrackedFile(isolated.repo);
			await gitRaw(isolated.repo, ['checkout', 'feature']);
			await fs.writeFile(path.join(isolated.repo, 'drop-me.txt'), 'drop\n');
			await gitRaw(isolated.repo, ['add', 'drop-me.txt']);
			await gitRaw(isolated.repo, ['commit', '-m', 'drop me']);
			const dropped = (await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim();
			await runAction(isolated.repo, 'dropCommit', { hash: dropped });
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim(), isolated.hashes.feature);
			const tree = await gitRaw(isolated.repo, ['ls-tree', '-r', '--name-only', 'HEAD']);
			assert.doesNotMatch(tree, /drop-me\.txt/);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('clean deletes untracked files', async () => {
		const isolated = await createFixtureRepo();
		try {
			assert.equal(await fs.readFile(path.join(isolated.repo, 'uncommitted.txt'), 'utf8'), isolated.files.uncommitted);
			await runAction(isolated.repo, 'clean', { directories: true });
			await assert.rejects(() => fs.access(path.join(isolated.repo, 'uncommitted.txt')), /ENOENT/);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('resetUncommitted hard restores a tracked file', async () => {
		const isolated = await createFixtureRepo();
		try {
			await cleanUntrackedFile(isolated.repo);
			await fs.writeFile(path.join(isolated.repo, 'README.md'), 'dirtied\n');
			await runAction(isolated.repo, 'resetUncommitted', { mode: 'hard' });
			const body = await fs.readFile(path.join(isolated.repo, 'README.md'), 'utf8');
			const oracle = await gitRawFull(isolated.repo, ['show', 'HEAD:README.md']);
			assert.equal(body, oracle);
			assert.notEqual(body, 'dirtied\n');
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('stashPop restores files and empties the stash list', async () => {
		const isolated = await createFixtureRepo();
		try {
			await runAction(isolated.repo, 'stash', { message: 'wip', includeUntracked: true });
			await assert.rejects(() => fs.access(path.join(isolated.repo, 'uncommitted.txt')), /ENOENT/);
			await runAction(isolated.repo, 'stashPop', { selector: 'stash@{0}' });
			assert.equal(await fs.readFile(path.join(isolated.repo, 'uncommitted.txt'), 'utf8'), isolated.files.uncommitted);
			const list = await gitRaw(isolated.repo, ['stash', 'list']);
			assert.equal(list.trim(), '');
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('stashDrop removes the stash without restoring the file', async () => {
		const isolated = await createFixtureRepo();
		try {
			await runAction(isolated.repo, 'stash', { message: 'wip', includeUntracked: true });
			await runAction(isolated.repo, 'stashDrop', { selector: 'stash@{0}' });
			await assert.rejects(() => fs.access(path.join(isolated.repo, 'uncommitted.txt')), /ENOENT/);
			assert.equal((await gitRaw(isolated.repo, ['stash', 'list'])).trim(), '');
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('stashBranch creates a branch that contains the stashed file', async () => {
		const isolated = await createFixtureRepo();
		try {
			await runAction(isolated.repo, 'stash', { message: 'wip', includeUntracked: true });
			await runAction(isolated.repo, 'stashBranch', { name: 'from-stash', selector: 'stash@{0}' });
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'from-stash');
			assert.equal(await fs.readFile(path.join(isolated.repo, 'uncommitted.txt'), 'utf8'), isolated.files.uncommitted);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('pull fast-forwards from a local bare remote', async () => {
		const isolated = await createFixtureRepo();
		const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'git-graph-bare-'));
		try {
			await cleanUntrackedFile(isolated.repo);
			await gitRaw(bare, ['init', '--bare']);
			await gitRaw(isolated.repo, ['remote', 'remove', 'origin']);
			await gitRaw(isolated.repo, ['remote', 'add', 'origin', bare]);
			await gitRaw(isolated.repo, ['push', '-u', 'origin', 'main']);
			await gitRaw(isolated.repo, ['reset', '--hard', isolated.hashes.mainTip]);
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim(), isolated.hashes.mainTip);
			await runAction(isolated.repo, 'pull', { remote: 'origin', branch: 'main' });
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim(), isolated.hashes.merge);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
			await fs.rm(bare, { recursive: true, force: true });
		}
	});

	it('deleteRemoteBranch removes the branch from a local bare remote', async () => {
		const isolated = await createFixtureRepo();
		const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'git-graph-bare-'));
		try {
			await cleanUntrackedFile(isolated.repo);
			await gitRaw(bare, ['init', '--bare']);
			await gitRaw(isolated.repo, ['remote', 'remove', 'origin']);
			await gitRaw(isolated.repo, ['remote', 'add', 'origin', bare]);
			await gitRaw(isolated.repo, ['push', 'origin', 'main']);
			await gitRaw(isolated.repo, ['push', 'origin', 'feature']);
			assert.match(await gitRaw(bare, ['show-ref']), /refs\/heads\/feature/);
			await runAction(isolated.repo, 'deleteRemoteBranch', { remote: 'origin', name: 'feature' });
			const refsAfter = await gitRaw(bare, ['show-ref']);
			assert.match(refsAfter, /refs\/heads\/main/);
			assert.doesNotMatch(refsAfter, /refs\/heads\/feature/);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
			await fs.rm(bare, { recursive: true, force: true });
		}
	});

	it('fetchIntoLocal recreates a deleted local branch from the remote', async () => {
		const isolated = await createFixtureRepo();
		const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'git-graph-bare-'));
		try {
			await cleanUntrackedFile(isolated.repo);
			await gitRaw(bare, ['init', '--bare']);
			await gitRaw(isolated.repo, ['remote', 'remove', 'origin']);
			await gitRaw(isolated.repo, ['remote', 'add', 'origin', bare]);
			await gitRaw(isolated.repo, ['push', 'origin', 'feature']);
			await gitRaw(isolated.repo, ['checkout', 'main']);
			await gitRaw(isolated.repo, ['branch', '-D', 'feature']);
			await assert.rejects(() => gitRaw(isolated.repo, ['rev-parse', 'refs/heads/feature']), /unknown revision|bad revision/i);
			await runAction(isolated.repo, 'fetchIntoLocal', {
				remote: 'origin',
				remoteBranch: 'feature',
				localBranch: 'feature'
			});
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'refs/heads/feature'])).trim(), isolated.hashes.feature);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
			await fs.rm(bare, { recursive: true, force: true });
		}
	});

	it('GET commits flags filter branches, remotes, and stashes', async () => {
		const isolated = await createFixtureRepo();
		try {
			await runAction(isolated.repo, 'stash', { message: 'wip', includeUntracked: true });
			const onlyFeature = await getCommits(isolated.repo, { branches: ['feature'], showStashes: false });
			const hashes = onlyFeature.commits.filter((c) => c.hash !== UNCOMMITTED).map((c) => c.hash);
			assert.ok(hashes.includes(isolated.hashes.feature));
			assert.ok(!hashes.includes(isolated.hashes.merge), 'merge on main should be hidden when only feature is requested');
			const noRemotes = await getCommits(isolated.repo, { showRemoteBranches: false, showStashes: false });
			assert.ok(noRemotes.commits.every((c) => !c.remotes || c.remotes.length === 0));
			const withStash = await getCommits(isolated.repo, { showStashes: true });
			assert.ok(withStash.commits.some((c) => c.stash && String(c.stash.selector).includes('stash@')));
			const hideStash = await getCommits(isolated.repo, { showStashes: false });
			assert.ok(!hideStash.commits.some((c) => c.stash));
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('HTTP POST /api/action revert is not Unknown API route and creates a revert commit', async () => {
		const isolated = await createFixtureRepo();
		await cleanUntrackedFile(isolated.repo);
		await gitRaw(isolated.repo, ['checkout', 'feature']);
		await fs.writeFile(path.join(isolated.repo, 'http-revert.txt'), 'tmp\n');
		await gitRaw(isolated.repo, ['add', 'http-revert.txt']);
		await gitRaw(isolated.repo, ['commit', '-m', 'http revert target']);
		const added = (await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim();
		const listening = await listenGitGraph({ repo: isolated.repo, host: '127.0.0.1', port: 0 });
		try {
			const res = await fetch(new URL('/api/action', listening.url), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Gitlane-Token': listening.csrfToken
				},
				body: JSON.stringify({ action: 'revert', hash: added })
			});
			assert.notEqual(res.status, 404, await res.text());
			assert.equal(res.status, 200);
			assert.match(await gitRaw(isolated.repo, ['log', '-1', '--format=%s']), /Revert/);
		} finally {
			await new Promise((resolve) => listening.server.close(resolve));
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});
});
