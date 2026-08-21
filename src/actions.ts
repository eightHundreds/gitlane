import { UNCOMMITTED } from './constants.js';
import { GitError, assertSafeRef, assertSafeText, getRepoInfo, runGit } from './git.js';

type P = Record<string, any>;

async function runGitEdit(repo: string, args: string[]) {
	return runGit(repo, args, {
		env: {
			GIT_EDITOR: 'true',
			GIT_SEQUENCE_EDITOR: 'true'
		}
	});
}

export async function checkout(repo: string, params: P) {
	const target = params.target || params.hash || params.branch;
	assertSafeRef(target, 'checkout target');
	await runGit(repo, ['checkout', target]);
	return getRepoInfo(repo);
}

export async function createBranch(repo: string, params: P) {
	const name = params.name;
	const commitHash = params.commitHash || params.hash;
	assertSafeRef(name, 'branch name');
	assertSafeRef(commitHash, 'commit hash');
	if (commitHash === UNCOMMITTED) throw new GitError('commit hash is required');
	const checkoutAfter = Boolean(params.checkout);
	const force = Boolean(params.force);
	if (checkoutAfter && !force) {
		await runGit(repo, ['checkout', '-b', name, commitHash]);
	} else {
		const args = ['branch'];
		if (force) args.push('-f');
		args.push(name, commitHash);
		await runGit(repo, args);
		if (checkoutAfter) await runGit(repo, ['checkout', name]);
	}
	return getRepoInfo(repo);
}

export async function deleteBranch(repo: string, params: P) {
	assertSafeRef(params.name, 'branch name');
	const args = ['branch', params.force ? '-D' : '-d', params.name];
	await runGit(repo, args);
	return getRepoInfo(repo);
}

export async function renameBranch(repo: string, params: P) {
	assertSafeRef(params.oldName, 'old branch name');
	assertSafeRef(params.newName, 'new branch name');
	await runGit(repo, ['branch', '-m', params.oldName, params.newName]);
	return getRepoInfo(repo);
}

export async function mergeRef(repo: string, params: P) {
	const ref = params.ref || params.hash;
	assertSafeRef(ref, 'merge ref');
	const dirtyBefore =
		(await runGit(repo, ['status', '--untracked-files=all', '--porcelain'])).trim() !== '';
	const args = ['merge', '--no-edit'];
	if (params.noFastForward) args.push('--no-ff');
	if (params.squash) args.push('--squash');
	args.push(ref);
	await runGitEdit(repo, args);
	if (!params.squash) return getRepoInfo(repo);
	try {
		await runGitEdit(repo, ['commit', '--no-edit', '-m', `Squash merge ${ref}`]);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		if (/nothing to commit/i.test(message)) return getRepoInfo(repo);
		try {
			await runGit(repo, ['reset', dirtyBefore ? '--mixed' : '--hard', 'HEAD']);
		} catch {
			// Reset is best-effort; the commit error is what callers should see.
		}
		throw err;
	}
	return getRepoInfo(repo);
}

export async function rebaseOnto(repo: string, params: P) {
	const ref = params.ref || params.hash;
	assertSafeRef(ref, 'rebase ref');
	await runGitEdit(repo, ['rebase', ref]);
	return getRepoInfo(repo);
}

export async function resetTo(repo: string, params: P) {
	const target = params.hash || params.commit || 'HEAD';
	assertSafeRef(target, 'reset target');
	const mode = params.mode || 'mixed';
	const flag = mode === 'soft' ? '--soft' : mode === 'hard' ? '--hard' : '--mixed';
	await runGit(repo, ['reset', flag, target]);
	return getRepoInfo(repo);
}

export async function cherryPick(repo: string, params: P) {
	assertSafeRef(params.hash, 'commit hash');
	const args = ['cherry-pick'];
	if (params.recordOrigin) args.push('-x');
	if (params.noCommit) args.push('-n');
	if (params.parentIndex) args.push('-m', String(params.parentIndex));
	args.push(params.hash);
	await runGitEdit(repo, args);
	return getRepoInfo(repo);
}

export async function revertCommit(repo: string, params: P) {
	assertSafeRef(params.hash, 'commit hash');
	const args = ['revert', '--no-edit'];
	if (params.parentIndex) args.push('-m', String(params.parentIndex));
	args.push(params.hash);
	await runGitEdit(repo, args);
	return getRepoInfo(repo);
}

export async function dropCommit(repo: string, params: P) {
	assertSafeRef(params.hash, 'commit hash');
	const line = (await runGit(repo, ['rev-list', '--parents', '-n', '1', params.hash])).trim();
	const parts = line.split(' ').filter(Boolean);
	if (parts.length > 2) throw new GitError('cannot drop a merge commit');
	if (parts.length < 2) throw new GitError('cannot drop a root commit');
	await runGitEdit(repo, ['rebase', '--onto', `${params.hash}^`, params.hash]);
	return getRepoInfo(repo);
}

export async function addTag(repo: string, params: P) {
	assertSafeRef(params.name, 'tag name');
	assertSafeRef(params.hash, 'commit hash');
	const args = ['tag'];
	if (params.annotated !== false) {
		args.push('-a', '-m', params.message || params.name);
	}
	args.push(params.name, params.hash);
	await runGit(repo, args);
	return getRepoInfo(repo);
}

export async function deleteTag(repo: string, params: P) {
	assertSafeRef(params.name, 'tag name');
	await runGit(repo, ['tag', '-d', params.name]);
	if (params.remote) {
		assertSafeRef(params.remote, 'remote');
		await runGit(repo, ['push', params.remote, `:refs/tags/${params.name}`]);
	}
	return getRepoInfo(repo);
}

export async function pushTag(repo: string, params: P) {
	assertSafeRef(params.name, 'tag name');
	assertSafeRef(params.remote, 'remote');
	await runGit(repo, ['push', params.remote, `refs/tags/${params.name}`]);
	return getRepoInfo(repo);
}

export async function pushBranch(repo: string, params: P) {
	assertSafeRef(params.name, 'branch name');
	assertSafeRef(params.remote, 'remote');
	const args = ['push'];
	if (params.setUpstream) args.push('-u');
	if (params.forceWithLease) args.push('--force-with-lease');
	else if (params.force) args.push('--force');
	args.push(params.remote, params.name);
	await runGit(repo, args);
	return getRepoInfo(repo);
}

export async function fetchRemotes(repo: string, params: P = {}) {
	const args = ['fetch'];
	if (params.prune) args.push('--prune');
	if (params.remote) {
		assertSafeRef(params.remote, 'remote');
		args.push(params.remote);
	} else {
		args.push('--all');
	}
	await runGit(repo, args);
	return getRepoInfo(repo);
}

export async function pullBranch(repo: string, params: P) {
	assertSafeRef(params.remote, 'remote');
	assertSafeRef(params.branch, 'branch name');
	const args = ['pull', '--no-edit'];
	if (params.noFastForward) args.push('--no-ff');
	if (params.squash) args.push('--squash');
	args.push(params.remote, params.branch);
	await runGitEdit(repo, args);
	return getRepoInfo(repo);
}

export async function deleteRemoteBranch(repo: string, params: P) {
	assertSafeRef(params.remote, 'remote');
	assertSafeRef(params.name, 'branch name');
	await runGit(repo, ['push', params.remote, '--delete', params.name]);
	return getRepoInfo(repo);
}

export async function fetchIntoLocal(repo: string, params: P) {
	assertSafeRef(params.remote, 'remote');
	assertSafeRef(params.remoteBranch, 'remote branch');
	assertSafeRef(params.localBranch, 'local branch');
	const spec = `refs/heads/${params.remoteBranch}:refs/heads/${params.localBranch}`;
	const args = ['fetch'];
	if (params.force) args.push('--force');
	args.push(params.remote, spec);
	await runGit(repo, args);
	return getRepoInfo(repo);
}

export async function stashPush(repo: string, params: P = {}) {
	const args = ['stash', 'push'];
	if (params.includeUntracked) args.push('-u');
	if (params.message) {
		assertSafeText(params.message, 'stash message');
		args.push('-m', params.message);
	}
	await runGit(repo, args);
	return getRepoInfo(repo);
}

export async function stashApply(repo: string, params: P = {}) {
	const selector = params.selector || 'stash@{0}';
	assertSafeRef(selector, 'stash selector');
	const args = ['stash', 'apply'];
	if (params.reinstateIndex) args.push('--index');
	args.push(selector);
	await runGit(repo, args);
	return getRepoInfo(repo);
}

export async function stashPop(repo: string, params: P = {}) {
	const selector = params.selector || 'stash@{0}';
	assertSafeRef(selector, 'stash selector');
	const args = ['stash', 'pop'];
	if (params.reinstateIndex) args.push('--index');
	args.push(selector);
	await runGit(repo, args);
	return getRepoInfo(repo);
}

export async function stashDrop(repo: string, params: P = {}) {
	const selector = params.selector || 'stash@{0}';
	assertSafeRef(selector, 'stash selector');
	await runGit(repo, ['stash', 'drop', selector]);
	return getRepoInfo(repo);
}

export async function stashBranch(repo: string, params: P) {
	assertSafeRef(params.name, 'branch name');
	const selector = params.selector || 'stash@{0}';
	assertSafeRef(selector, 'stash selector');
	await runGit(repo, ['stash', 'branch', params.name, selector]);
	return getRepoInfo(repo);
}

export async function cleanUntracked(repo: string, params: P = {}) {
	const args = ['clean', '-f'];
	if (params.directories !== false) args.push('-d');
	await runGit(repo, args);
	return getRepoInfo(repo);
}

const ACTION_MAP: Record<string, (repo: string, params: P) => Promise<unknown>> = {
	checkout,
	createBranch,
	deleteBranch,
	renameBranch,
	merge: mergeRef,
	rebase: rebaseOnto,
	reset: resetTo,
	cherryPick,
	revert: revertCommit,
	dropCommit,
	addTag,
	deleteTag,
	pushTag,
	pushBranch,
	fetch: fetchRemotes,
	pull: pullBranch,
	deleteRemoteBranch,
	fetchIntoLocal,
	stash: stashPush,
	stashApply,
	stashPop,
	stashDrop,
	stashBranch,
	clean: cleanUntracked,
	resetUncommitted: (repo: string, params: P) => resetTo(repo, { hash: 'HEAD', mode: params.mode || 'mixed' })
};

export async function runAction(repo: string, action: string, params: P = {}) {
	const fn = ACTION_MAP[action];
	if (!fn) throw new GitError(`unknown action: ${action}`);
	return fn(repo, params);
}

export const ACTION_NAMES = Object.keys(ACTION_MAP);
