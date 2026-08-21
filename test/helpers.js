import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/** Independent git oracle — does not import the code under test. */
export async function gitRaw(repo, args) {
	const { stdout } = await execFileAsync('git', args, {
		cwd: repo,
		encoding: 'utf8',
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
	});
	return stdout.replace(/\n$/, '');
}

export async function gitRawFull(repo, args) {
	const { stdout } = await execFileAsync('git', args, {
		cwd: repo,
		encoding: 'utf8',
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
	});
	return stdout;
}

/**
 * Real temp git repo: two branches, a merge commit, a tag, a dirty working tree,
 * and a known file body used by file-at-revision assertions.
 */
export async function createFixtureRepo() {
	const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'git-graph-fixture-'));
	await gitRaw(repo, ['init']);
	await gitRaw(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
	await gitRaw(repo, ['config', 'user.name', 'Fixture User']);
	await gitRaw(repo, ['config', 'user.email', 'fixture@example.com']);
	await gitRaw(repo, ['config', 'commit.gpgsign', 'false']);
	await gitRaw(repo, ['config', 'tag.gpgsign', 'false']);
	await gitRaw(repo, ['config', 'init.defaultBranch', 'main']);

	const files = {
		readmeInitial: 'hello world\n',
		readmeFeature: 'hello feature\n',
		featureFile: 'feature file contents v1\n',
		mainOnly: 'on main\n',
		uncommitted: 'dirty payload\n'
	};

	await fs.writeFile(path.join(repo, 'README.md'), files.readmeInitial);
	await gitRaw(repo, ['add', 'README.md']);
	await gitRaw(repo, ['commit', '-m', 'initial commit']);
	const initial = (await gitRaw(repo, ['rev-parse', 'HEAD'])).trim();

	await gitRaw(repo, ['checkout', '-b', 'feature']);
	await fs.writeFile(path.join(repo, 'README.md'), files.readmeFeature);
	await fs.writeFile(path.join(repo, 'feature.txt'), files.featureFile);
	await gitRaw(repo, ['add', 'README.md', 'feature.txt']);
	await gitRaw(repo, ['commit', '-m', 'add feature work']);
	const feature = (await gitRaw(repo, ['rev-parse', 'HEAD'])).trim();

	await gitRaw(repo, ['checkout', 'main']);
	await fs.writeFile(path.join(repo, 'main-only.txt'), files.mainOnly);
	await gitRaw(repo, ['add', 'main-only.txt']);
	await gitRaw(repo, ['commit', '-m', 'main continuation']);
	const mainTip = (await gitRaw(repo, ['rev-parse', 'HEAD'])).trim();

	await gitRaw(repo, ['merge', '--no-ff', 'feature', '-m', 'merge feature into main']);
	const merge = (await gitRaw(repo, ['rev-parse', 'HEAD'])).trim();

	await gitRaw(repo, ['tag', '-a', 'v1.0', '-m', 'release 1.0']);
	await gitRaw(repo, ['remote', 'add', 'origin', 'https://example.com/fixture.git']);
	await gitRaw(repo, ['update-ref', 'refs/remotes/origin/main', merge]);

	await fs.writeFile(path.join(repo, 'uncommitted.txt'), files.uncommitted);

	return {
		repo,
		files,
		hashes: { initial, feature, mainTip, merge },
		subjects: {
			initial: 'initial commit',
			feature: 'add feature work',
			mainTip: 'main continuation',
			merge: 'merge feature into main'
		}
	};
}

export async function createEmptyRepo() {
	const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'git-graph-empty-'));
	await gitRaw(repo, ['init']);
	await gitRaw(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
	await gitRaw(repo, ['config', 'user.name', 'Fixture User']);
	await gitRaw(repo, ['config', 'user.email', 'fixture@example.com']);
	await gitRaw(repo, ['config', 'commit.gpgsign', 'false']);
	return repo;
}

export function parseNameStatus(text) {
	const rows = [];
	for (const line of text.split('\n')) {
		if (!line) continue;
		const cols = line.split('\t');
		const type = cols[0][0];
		if (type === 'R' || type === 'C') {
			rows.push({ type: 'R', oldFilePath: cols[1], newFilePath: cols[2] });
		} else {
			rows.push({ type, oldFilePath: cols[1], newFilePath: cols[1] });
		}
	}
	return rows;
}

export function postAction(listening, body) {
	return fetch(new URL('/api/action', listening.url), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Gitlane-Token': listening.csrfToken
		},
		body: JSON.stringify(body)
	});
}

export function layoutHasParentEdge(layout, childId, parentId) {
	for (const branch of layout.branches) {
		const adj = new Map();
		for (const line of branch.lines) {
			const a = line.p1.y;
			const b = line.p2.y;
			if (!adj.has(a)) adj.set(a, new Set());
			if (!adj.has(b)) adj.set(b, new Set());
			adj.get(a).add(b);
			adj.get(b).add(a);
		}
		const seen = new Set();
		const stack = [childId];
		while (stack.length) {
			const n = stack.pop();
			if (n === parentId) return true;
			if (seen.has(n)) continue;
			seen.add(n);
			for (const nxt of adj.get(n) || []) stack.push(nxt);
		}
	}
	return false;
}
