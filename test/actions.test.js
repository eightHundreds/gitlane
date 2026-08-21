import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo, gitRaw, postAction } from './helpers.js';
import { getCommits, getTagDetails, UNCOMMITTED } from '../dist/git.js';
import { runAction } from '../dist/actions.js';
import { listenGitGraph } from '../dist/server.js';

describe('git actions on a real repository', () => {
	let fx;

	before(async () => {
		fx = await createFixtureRepo();
	});

	after(async () => {
		if (fx?.repo) await fs.rm(fx.repo, { recursive: true, force: true });
	});

	it('addTag/deleteTag and annotated tag details match git', async () => {
		const isolated = await createFixtureRepo();
		try {
			await runAction(isolated.repo, 'addTag', {
				name: 'hot',
				hash: isolated.hashes.merge,
				message: 'hot tag',
				annotated: true
			});
			const tagged = (await gitRaw(isolated.repo, ['rev-parse', 'refs/tags/hot^{}'])).trim();
			assert.equal(tagged, isolated.hashes.merge);
			const details = await getTagDetails(isolated.repo, 'hot');
			assert.equal(details.annotated, true);
			assert.equal(details.commitHash, isolated.hashes.merge);
			assert.match(details.message, /hot tag/);
			await runAction(isolated.repo, 'deleteTag', { name: 'hot' });
			await assert.rejects(() => gitRaw(isolated.repo, ['rev-parse', 'refs/tags/hot']), /unknown revision|bad revision|ambiguous/i);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('cherry-pick applies a unique commit onto main', async () => {
		const isolated = await createFixtureRepo();
		try {
			await fs.unlink(path.join(isolated.repo, 'uncommitted.txt'));
			await gitRaw(isolated.repo, ['checkout', 'feature']);
			await fs.writeFile(path.join(isolated.repo, 'picked.txt'), 'picked body\n');
			await gitRaw(isolated.repo, ['add', 'picked.txt']);
			await gitRaw(isolated.repo, ['commit', '-m', 'unique pick']);
			const pick = (await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim();
			await gitRaw(isolated.repo, ['checkout', 'main']);
			await runAction(isolated.repo, 'cherryPick', { hash: pick });
			const body = await fs.readFile(path.join(isolated.repo, 'picked.txt'), 'utf8');
			assert.equal(body, 'picked body\n');
			const log = await gitRaw(isolated.repo, ['log', '-1', '--format=%s']);
			assert.match(log, /unique pick/);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('stash message starting with a dash is not treated as a git flag', async () => {
		const isolated = await createFixtureRepo();
		try {
			await runAction(isolated.repo, 'stash', { message: '-not-a-flag', includeUntracked: true });
			const list = await gitRaw(isolated.repo, ['stash', 'list']);
			assert.match(list, /not-a-flag/);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('stash push hides dirty files and apply restores them', async () => {
		const isolated = await createFixtureRepo();
		try {
			assert.ok((await getCommits(isolated.repo)).commits.some((c) => c.hash === UNCOMMITTED));
			await runAction(isolated.repo, 'stash', { message: 'wip', includeUntracked: true });
			const after = await getCommits(isolated.repo);
			assert.ok(!after.commits.some((c) => c.hash === UNCOMMITTED));
			assert.ok(after.commits.some((c) => c.stash && c.stash.selector.includes('stash@')));
			await runAction(isolated.repo, 'stashApply', { selector: 'stash@{0}' });
			const dirty = await fs.readFile(path.join(isolated.repo, 'uncommitted.txt'), 'utf8');
			assert.equal(dirty, isolated.files.uncommitted);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('renameBranch and deleteBranch mutate refs', async () => {
		const isolated = await createFixtureRepo();
		try {
			await runAction(isolated.repo, 'renameBranch', { oldName: 'feature', newName: 'topic' });
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'refs/heads/topic'])).trim(), isolated.hashes.feature);
			await runAction(isolated.repo, 'deleteBranch', { name: 'topic', force: true });
			await assert.rejects(() => gitRaw(isolated.repo, ['rev-parse', 'refs/heads/topic']), /unknown revision|bad revision|ambiguous/i);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('reset mixed moves HEAD and keeps the working tree file', async () => {
		const isolated = await createFixtureRepo();
		try {
			await fs.unlink(path.join(isolated.repo, 'uncommitted.txt'));
			await runAction(isolated.repo, 'reset', { hash: isolated.hashes.mainTip, mode: 'mixed' });
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim(), isolated.hashes.mainTip);
			const exists = await fs
				.access(path.join(isolated.repo, 'feature.txt'))
				.then(() => true)
				.catch(() => false);
			assert.equal(exists, true);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('HTTP reset via /api/action moves HEAD; named /api/reset is not a write route', async () => {
		const isolated = await createFixtureRepo();
		await fs.unlink(path.join(isolated.repo, 'uncommitted.txt'));
		const listening = await listenGitGraph({ repo: isolated.repo, host: '127.0.0.1', port: 0 });
		try {
			const viaAction = await postAction(listening, {
				action: 'reset',
				hash: isolated.hashes.mainTip,
				mode: 'mixed'
			});
			assert.notEqual(viaAction.status, 404, await viaAction.text());
			assert.equal(viaAction.status, 200);
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim(), isolated.hashes.mainTip);

			const named = await fetch(new URL('/api/reset', listening.url), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Gitlane-Token': listening.csrfToken
				},
				body: JSON.stringify({ hash: isolated.hashes.initial, mode: 'mixed' })
			});
			assert.equal(named.status, 404);
			assert.match((await named.json()).error, /Unknown API route/);
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim(), isolated.hashes.mainTip);

			const again = await postAction(listening, {
				action: 'reset',
				hash: isolated.hashes.initial,
				mode: 'mixed'
			});
			assert.equal(again.status, 200);
			assert.equal((await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim(), isolated.hashes.initial);
		} finally {
			await new Promise((resolve) => listening.server.close(resolve));
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('push and fetch work against a local bare remote', async () => {
		const isolated = await createFixtureRepo();
		const bare = await fs.mkdtemp(path.join(path.dirname(isolated.repo), 'git-graph-bare-'));
		try {
			await gitRaw(bare, ['init', '--bare']);
			await gitRaw(isolated.repo, ['remote', 'remove', 'origin']);
			await gitRaw(isolated.repo, ['remote', 'add', 'origin', bare]);
			await runAction(isolated.repo, 'pushBranch', { name: 'main', remote: 'origin', setUpstream: true });
			const remoteHead = (await gitRaw(bare, ['rev-parse', 'refs/heads/main'])).trim();
			assert.equal(remoteHead, isolated.hashes.merge);
			await runAction(isolated.repo, 'addTag', {
				name: 'ship',
				hash: isolated.hashes.merge,
				annotated: true,
				message: 'ship'
			});
			await runAction(isolated.repo, 'pushTag', { name: 'ship', remote: 'origin' });
			assert.equal((await gitRaw(bare, ['rev-parse', 'refs/tags/ship^{}'])).trim(), isolated.hashes.merge);
			await runAction(isolated.repo, 'fetch', { remote: 'origin' });
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
			await fs.rm(bare, { recursive: true, force: true });
		}
	});

	it('HTTP /api/action cherry-picks and rejects unknown actions', async () => {
		const isolated = await createFixtureRepo();
		await fs.unlink(path.join(isolated.repo, 'uncommitted.txt'));
		await gitRaw(isolated.repo, ['checkout', 'feature']);
		await fs.writeFile(path.join(isolated.repo, 'http-pick.txt'), 'via http\n');
		await gitRaw(isolated.repo, ['add', 'http-pick.txt']);
		await gitRaw(isolated.repo, ['commit', '-m', 'http pick']);
		const pick = (await gitRaw(isolated.repo, ['rev-parse', 'HEAD'])).trim();
		await gitRaw(isolated.repo, ['checkout', 'main']);
		const listening = await listenGitGraph({ repo: isolated.repo, host: '127.0.0.1', port: 0 });
		try {
			const unknown = await fetch(new URL('/api/action', listening.url), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Gitlane-Token': listening.csrfToken
				},
				body: JSON.stringify({ action: 'not-a-real-action' })
			});
			assert.ok(unknown.status >= 400);
			assert.match((await unknown.json()).error, /unknown action/);

			const ok = await fetch(new URL('/api/action', listening.url), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Gitlane-Token': listening.csrfToken
				},
				body: JSON.stringify({ action: 'cherryPick', hash: pick })
			});
			assert.equal(ok.status, 200);
			const body = await fs.readFile(path.join(isolated.repo, 'http-pick.txt'), 'utf8');
			assert.equal(body, 'via http\n');
		} finally {
			await new Promise((resolve) => listening.server.close(resolve));
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('merge --no-ff brings a unique feature commit onto main', async () => {
		const isolated = await createFixtureRepo();
		try {
			await fs.unlink(path.join(isolated.repo, 'uncommitted.txt'));
			await gitRaw(isolated.repo, ['checkout', 'feature']);
			await fs.writeFile(path.join(isolated.repo, 'merged-in.txt'), 'from feature\n');
			await gitRaw(isolated.repo, ['add', 'merged-in.txt']);
			await gitRaw(isolated.repo, ['commit', '-m', 'feature unique']);
			await gitRaw(isolated.repo, ['checkout', 'main']);
			await runAction(isolated.repo, 'merge', { ref: 'feature', noFastForward: true });
			const body = await fs.readFile(path.join(isolated.repo, 'merged-in.txt'), 'utf8');
			assert.equal(body, 'from feature\n');
			const parents = (await gitRaw(isolated.repo, ['log', '-1', '--format=%P'])).trim().split(' ');
			assert.equal(parents.length, 2);
		} finally {
			await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	it('moreCommitsAvailable is true when the log is truncated', async () => {
		const data = await getCommits(fx.repo, { maxCommits: 2 });
		assert.equal(data.moreCommitsAvailable, true);
		assert.ok(data.branches.includes('main'));
		assert.ok(data.branches.includes('feature'));
	});
});
