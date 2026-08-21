import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_MAX_COMMITS, UNCOMMITTED } from './constants.js';
import { layoutGraph } from './layout.js';
import {
	assembleCommitGraph,
	insertStashes,
	uncommittedCommit
} from './graph-model.js';
import type { FileChange, StashRecord } from './types.js';

export { layoutGraph };
export { assembleCommitGraph, insertStashes, uncommittedCommit } from './graph-model.js';

const execFileAsync = promisify(execFile);
const LOG_SEP = 'XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb';
const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s'].join(LOG_SEP);
const DETAILS_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join(LOG_SEP);

export { UNCOMMITTED };

export class GitError extends Error {
	args?: string[];
	code?: string | number;
	statusCode?: number;
	constructor(message: string, extra: { args?: string[]; code?: string | number } = {}) {
		super(message);
		this.name = 'GitError';
		this.args = extra.args;
		this.code = extra.code;
	}
}

type GitRunOptions = {
	maxBuffer?: number;
	env?: NodeJS.ProcessEnv;
};

/**
 * Run git in `repo`. Returns stdout as a string.
 */
export async function runGit(repo: string, args: string[], options: GitRunOptions = {}): Promise<string> {
	try {
		const { stdout } = await execFileAsync('git', args, {
			cwd: repo,
			encoding: 'utf8',
			maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: '0',
				GIT_OPTIONAL_LOCKS: '0',
				GCM_INTERACTIVE: 'never',
				...(options.env || {})
			}
		});
		return stdout;
	} catch (err: unknown) {
		const e = err as { stderr?: string; stdout?: string; message?: string; code?: string | number };
		const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n').trim();
		throw new GitError(detail || 'git failed', { args, code: e.code });
	}
}

export async function resolveRepo(inputPath: string) {
	const abs = path.resolve(inputPath);
	const toplevel = (await runGit(abs, ['rev-parse', '--show-toplevel'])).trim();
	return path.resolve(toplevel);
}

export async function isGitRepo(inputPath: string) {
	try {
		await resolveRepo(inputPath);
		return true;
	} catch {
		return false;
	}
}

function splitLines(text: string) {
	if (!text) return [];
	return text.split(/\r\n|\r|\n/);
}

function parseNameStatusZ(stdout: string, dropFirst = false) {
	const parts = stdout.split('\0');
	if (dropFirst && parts.length) parts.shift();
	const records = [];
	let i = 0;
	while (i < parts.length) {
		const spec = parts[i];
		if (!spec) {
			i++;
			continue;
		}
		const type = spec[0];
		if (type === 'R' || type === 'C') {
			const oldFilePath = parts[i + 1];
			const newFilePath = parts[i + 2];
			if (!oldFilePath || !newFilePath) break;
			records.push({ type: 'R', oldFilePath, newFilePath });
			i += 3;
		} else if (type === 'A' || type === 'M' || type === 'D' || type === 'T') {
			const p = parts[i + 1];
			if (!p) break;
			records.push({ type: type === 'T' ? 'M' : type, oldFilePath: p, newFilePath: p });
			i += 2;
		} else {
			i += 1;
		}
	}
	return records;
}

function parseNumStatZ(stdout: string, dropFirst = false) {
	const parts = stdout.split('\0');
	if (dropFirst && parts.length) parts.shift();
	const records = [];
	let i = 0;
	while (i < parts.length && parts[i] !== '') {
		const fields = parts[i].split('\t');
		if (fields.length !== 3) break;
		if (fields[2] !== '') {
			records.push({
				filePath: fields[2],
				additions: fields[0] === '-' ? null : parseInt(fields[0], 10),
				deletions: fields[1] === '-' ? null : parseInt(fields[1], 10)
			});
			i += 1;
		} else {
			records.push({
				filePath: parts[i + 2],
				additions: fields[0] === '-' ? null : parseInt(fields[0], 10),
				deletions: fields[1] === '-' ? null : parseInt(fields[1], 10)
			});
			i += 3;
		}
	}
	return records;
}

async function execDiff(repo: string, fromHash: string, toHash: string, flag: string, filter = 'AMDR') {
	let args;
	const same = fromHash && toHash && fromHash === toHash;
	if (same || !fromHash) {
		args = ['diff-tree', flag, '-r', '--root', '--find-renames', `--diff-filter=${filter}`, '-z', toHash];
	} else {
		args = ['diff', flag, '--find-renames', `--diff-filter=${filter}`, '-z', fromHash];
		if (toHash && toHash !== UNCOMMITTED) args.push(toHash);
	}
	const stdout = await runGit(repo, args);
	return { stdout, dropFirst: Boolean(same || !fromHash) };
}

async function getDiffNameStatus(repo: string, fromHash: string, toHash: string) {
	const { stdout, dropFirst } = await execDiff(repo, fromHash, toHash, '--name-status');
	return parseNameStatusZ(stdout, dropFirst);
}

async function getDiffNumStat(repo: string, fromHash: string, toHash: string) {
	const { stdout, dropFirst } = await execDiff(repo, fromHash, toHash, '--numstat');
	return parseNumStatZ(stdout, dropFirst);
}

function parsePorcelainZ(stdout: string) {
	const output = stdout.split('\0');
	const entries = [];
	let i = 0;
	while (i < output.length && output[i] !== '') {
		if (output[i].length < 4) break;
		const c1 = output[i].substring(0, 1);
		const c2 = output[i].substring(1, 2);
		entries.push({ filePath: output[i].substring(3), c1, c2 });
		i += c1 === 'R' || c2 === 'R' || c1 === 'C' || c2 === 'C' ? 2 : 1;
	}
	return entries;
}

async function readPorcelainStatus(repo: string) {
	return parsePorcelainZ(
		await runGit(repo, ['status', '-s', '--untracked-files=all', '--porcelain', '-z'])
	);
}

async function getStatusFiles(repo: string) {
	const status: { deleted: string[]; untracked: string[] } = { deleted: [], untracked: [] };
	for (const { filePath, c1, c2 } of await readPorcelainStatus(repo)) {
		if (c1 === 'D' || c2 === 'D') status.deleted.push(filePath);
		else if (c1 === '?' || c2 === '?') status.untracked.push(filePath);
	}
	return status;
}

function mergeFileChanges(
	nameStatus: { type: string; oldFilePath: string; newFilePath: string }[],
	numStat: { filePath: string; additions: number | null; deletions: number | null }[],
	status: { deleted: string[]; untracked: string[] } | null
) {
	const fileChanges: FileChange[] = [];
	const lookup: Record<string, number> = {};
	for (const rec of nameStatus) {
		lookup[rec.newFilePath] = fileChanges.length;
		fileChanges.push({
			oldFilePath: rec.oldFilePath,
			newFilePath: rec.newFilePath,
			type: rec.type,
			additions: null,
			deletions: null
		});
	}
	if (status) {
		for (const filePath of status.deleted) {
			if (typeof lookup[filePath] === 'number') {
				fileChanges[lookup[filePath]].type = 'D';
			} else {
				fileChanges.push({
					oldFilePath: filePath,
					newFilePath: filePath,
					type: 'D',
					additions: null,
					deletions: null
				});
			}
		}
		for (const filePath of status.untracked) {
			if (typeof lookup[filePath] === 'number') {
				const existing = fileChanges[lookup[filePath]];
				if (existing.type === 'D') existing.type = 'M';
				continue;
			}
			lookup[filePath] = fileChanges.length;
			fileChanges.push({
				oldFilePath: filePath,
				newFilePath: filePath,
				type: 'U',
				additions: null,
				deletions: null
			});
		}
	}
	for (const rec of numStat) {
		if (typeof lookup[rec.filePath] === 'number') {
			fileChanges[lookup[rec.filePath]].additions = rec.additions;
			fileChanges[lookup[rec.filePath]].deletions = rec.deletions;
		}
	}
	return fileChanges;
}

async function getRefs(repo: string) {
	let stdout;
	try {
		stdout = await runGit(repo, ['show-ref', '-d', '--head']);
	} catch {
		return { head: null, heads: [], tags: [], remotes: [] };
	}
	const refData: {
		head: string | null;
		heads: { hash: string; name: string }[];
		tags: { hash: string; name: string; annotated: boolean }[];
		remotes: { hash: string; name: string }[];
	} = { head: null, heads: [], tags: [], remotes: [] };
	const tagByName = new Map();
	for (const line of splitLines(stdout)) {
		if (!line) continue;
		const sp = line.indexOf(' ');
		if (sp < 0) continue;
		const hash = line.slice(0, sp);
		const ref = line.slice(sp + 1);
		if (ref.startsWith('refs/heads/')) {
			refData.heads.push({ hash, name: ref.slice(11) });
		} else if (ref.startsWith('refs/tags/')) {
			const annotated = ref.endsWith('^{}');
			const name = annotated ? ref.slice(10, -3) : ref.slice(10);
			const existing = tagByName.get(name);
			if (!existing || annotated) {
				const entry = { hash, name, annotated };
				if (existing) {
					const idx = refData.tags.indexOf(existing);
					if (idx >= 0) refData.tags[idx] = entry;
				} else {
					refData.tags.push(entry);
				}
				tagByName.set(name, entry);
			}
		} else if (ref.startsWith('refs/remotes/')) {
			if (!ref.endsWith('/HEAD')) {
				refData.remotes.push({ hash, name: ref.slice(13) });
			}
		} else if (ref === 'HEAD') {
			refData.head = hash;
		}
	}
	return refData;
}

async function countUncommitted(repo: string) {
	const stdout = await runGit(repo, ['status', '--untracked-files=all', '--porcelain']);
	const lines = splitLines(stdout).filter((l) => l !== '');
	return lines.length;
}

async function branchFromSymbolicRef(repo: string) {
	try {
		const ref = (await runGit(repo, ['symbolic-ref', '--quiet', 'HEAD'])).trim();
		if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
		return ref || null;
	} catch {
		return null;
	}
}

async function getHeadBranch(repo: string) {
	try {
		const name = (await runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		if (!name || name === 'HEAD') return branchFromSymbolicRef(repo);
		return name;
	} catch {
		// Unborn HEAD (`git init` with no commits) fails rev-parse.
		return branchFromSymbolicRef(repo);
	}
}

export async function listRemotes(repo: string) {
	try {
		const stdout = await runGit(repo, ['remote']);
		return splitLines(stdout)
			.map((s) => s.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export async function listStashes(repo: string): Promise<StashRecord[]> {
	let stdout = '';
	try {
		stdout = await runGit(repo, [
			'stash',
			'list',
			'--format=%H%x1f%gd%x1f%P%x1f%at%x1f%an%x1f%ae%x1f%s'
		]);
	} catch {
		return [];
	}
	const stashes = [];
	for (const line of splitLines(stdout)) {
		if (!line) continue;
		const [hash, selector, parents, date, author, email, message] = line.split('\x1f');
		if (!hash || !selector) continue;
		const parentHashes = parents ? parents.split(' ').filter(Boolean) : [];
		stashes.push({
			hash,
			selector,
			baseHash: parentHashes[0] || null,
			date: parseInt(date, 10) || 0,
			author: author || '',
			email: email || '',
			message: message || selector
		});
	}
	return stashes;
}

export async function getTagDetails(repo: string, name: string) {
	if (!name || typeof name !== 'string' || name.startsWith('-') || /[\0\n\r]/.test(name)) {
		throw new GitError('invalid tag name');
	}
	let objectType = '';
	try {
		objectType = (await runGit(repo, ['cat-file', '-t', `refs/tags/${name}`])).trim();
	} catch {
		throw new GitError(`tag not found: ${name}`);
	}
	const commitHash = (await runGit(repo, ['rev-parse', `refs/tags/${name}^{}`])).trim();
	if (objectType !== 'tag') {
		return {
			name,
			annotated: false,
			tagHash: commitHash,
			commitHash,
			tagger: '',
			email: '',
			date: 0,
			message: ''
		};
	}
	const tagHash = (await runGit(repo, ['rev-parse', `refs/tags/${name}`])).trim();
	const payload = await runGit(repo, ['cat-file', '-p', `refs/tags/${name}`]);
	const taggerLine = payload.split(/\r\n|\r|\n/).find((l) => l.startsWith('tagger ')) || '';
	const taggerMatch = taggerLine.match(/^tagger (.+) <([^>]+)> (\d+)/);
	const blank = payload.indexOf('\n\n');
	const message = blank >= 0 ? payload.slice(blank + 2).replace(/\n+$/, '') : '';
	return {
		name,
		annotated: true,
		tagHash,
		commitHash,
		tagger: taggerMatch ? taggerMatch[1] : '',
		email: taggerMatch ? taggerMatch[2] : '',
		date: taggerMatch ? parseInt(taggerMatch[3], 10) : 0,
		message
	};
}

export async function getRepoInfo(repo: string) {
	const [refs, branch, uncommitted] = await Promise.all([
		getRefs(repo),
		getHeadBranch(repo),
		countUncommitted(repo)
	]);
	return {
		repo,
		head: refs.head,
		branch,
		detached: branch === null && refs.head !== null,
		uncommitted
	};
}

async function headExists(repo: string) {
	try {
		await runGit(repo, ['rev-parse', '--verify', 'HEAD']);
		return true;
	} catch {
		return false;
	}
}

async function repoHasCommits(repo: string) {
	try {
		return (await runGit(repo, ['rev-list', '-n', '1', '--all'])).trim() !== '';
	} catch {
		return false;
	}
}

function isSafeRev(value: unknown) {
	return Boolean(value) && typeof value === 'string' && !value.startsWith('-') && !/[\0\n\r]/.test(value);
}

async function readCommitLog(
	repo: string,
	options: {
		maxCommits: number;
		branchFilter: string[] | null;
		showRemoteBranches: boolean;
		showTags: boolean;
		hasHead: boolean;
		extraTips?: string[];
	}
) {
	const { maxCommits, branchFilter, showRemoteBranches, showTags, hasHead, extraTips } = options;
	const args = [
		'-c',
		'log.showSignature=false',
		'log',
		`--max-count=${maxCommits}`,
		`--format=${LOG_FORMAT}`,
		'--date-order'
	];
	if (branchFilter) {
		for (const b of branchFilter) {
			if (isSafeRev(b)) args.push(b);
		}
	} else {
		args.push('--branches');
		if (showTags) args.push('--tags');
		if (showRemoteBranches) args.push('--remotes');
		if (hasHead) args.push('HEAD');
		// Unfiltered logs also start from stash bases so max-count cannot
		// hide the commit a stash sits on. A branch filter omits extra tips:
		// insertStashes then drops stashes whose base is not in the log.
		for (const tip of extraTips || []) {
			if (isSafeRev(tip)) args.push(tip);
		}
	}
	args.push('--');
	const logOut = await runGit(repo, args);
	const commits = [];
	for (const line of splitLines(logOut)) {
		if (!line) continue;
		const parts = line.split(LOG_SEP);
		if (parts.length < 6) continue;
		commits.push({
			hash: parts[0],
			parents: parts[1] !== '' ? parts[1].split(' ') : [],
			author: parts[2],
			email: parts[3],
			date: parseInt(parts[4], 10),
			message: parts[5]
		});
	}
	return commits;
}

/**
 * Load commits, attach refs, optionally prepend uncommitted node, and layout lanes.
 */
export async function getCommits(
	repo: string,
	options: {
		maxCommits?: number;
		showRemoteBranches?: boolean;
		showStashes?: boolean;
		showTags?: boolean;
		branches?: string[] | null;
	} = {}
) {
	const maxCommits = options.maxCommits ?? DEFAULT_MAX_COMMITS;
	const showRemoteBranches = options.showRemoteBranches !== false;
	const showStashes = options.showStashes !== false;
	const showTags = options.showTags !== false;
	const branchFilter = Array.isArray(options.branches) && options.branches.length ? options.branches : null;

	const [hasHead, hasCommits, refs, stashList, uncommittedCount, branch, remotes] = await Promise.all([
		headExists(repo),
		repoHasCommits(repo),
		getRefs(repo),
		showStashes ? listStashes(repo) : Promise.resolve([]),
		countUncommitted(repo),
		getHeadBranch(repo),
		listRemotes(repo)
	]);

	const stashBaseHashes = [
		...new Set(stashList.map((s) => s.baseHash).filter((h): h is string => typeof h === 'string' && h.length > 0))
	];
	const logCommits = hasCommits
		? await readCommitLog(repo, {
				maxCommits,
				branchFilter,
				showRemoteBranches,
				showTags,
				hasHead,
				extraTips: stashBaseHashes
			})
		: [];
	const moreCommitsAvailable = logCommits.length >= maxCommits;

	const { commits, layout } = assembleCommitGraph({
		logCommits,
		stashList,
		uncommittedRow: uncommittedCount > 0 ? uncommittedCommit(refs.head, uncommittedCount) : null,
		refs,
		showTags,
		showRemoteBranches
	});
	return {
		repo,
		head: refs.head,
		moreCommitsAvailable,
		maxCommits,
		branches: refs.heads.map((h) => h.name),
		remotes,
		branch,
		detached: branch === null && refs.head !== null,
		commits,
		layout
	};
}

async function getUnbornFileChanges(repo: string) {
	return (await readPorcelainStatus(repo)).map(({ filePath, c1, c2 }) => {
		let type = 'M';
		if (c1 === '?' || c2 === '?') type = 'U';
		else if (c1 === 'A' || c2 === 'A') type = 'A';
		else if (c1 === 'D' || c2 === 'D') type = 'D';
		return {
			oldFilePath: filePath,
			newFilePath: filePath,
			type,
			additions: null,
			deletions: null
		};
	});
}

export async function getCommitDetails(repo: string, hash: string) {
	if (hash === UNCOMMITTED) {
		const info = await getRepoInfo(repo);
		if (!info.head) {
			return {
				hash: UNCOMMITTED,
				parents: [],
				author: '',
				email: '',
				date: Math.round(Date.now() / 1000),
				committer: '',
				committerEmail: '',
				committerDate: 0,
				body: 'Working tree (no commits yet)',
				fileChanges: await getUnbornFileChanges(repo),
				fromHash: null,
				toHash: UNCOMMITTED
			};
		}
		const [nameStatus, numStat, status] = await Promise.all([
			getDiffNameStatus(repo, 'HEAD', UNCOMMITTED),
			getDiffNumStat(repo, 'HEAD', UNCOMMITTED),
			getStatusFiles(repo)
		]);
		return {
			hash: UNCOMMITTED,
			parents: info.head ? [info.head] : [],
			author: '',
			email: '',
			date: Math.round(Date.now() / 1000),
			committer: '',
			committerEmail: '',
			committerDate: 0,
			body: '',
			fileChanges: mergeFileChanges(nameStatus, numStat, status),
			fromHash: info.head,
			toHash: UNCOMMITTED
		};
	}

	const stdout = await runGit(repo, [
		'-c',
		'log.showSignature=false',
		'show',
		'--quiet',
		hash,
		`--format=${DETAILS_FORMAT}`
	]);
	const parts = stdout.split(LOG_SEP);
	const parents = parts[1] !== '' ? parts[1].split(' ').filter(Boolean) : [];
	const fromHash = parents.length > 0 ? `${hash}^` : hash;
	const [nameStatus, numStat] = await Promise.all([
		getDiffNameStatus(repo, fromHash, hash),
		getDiffNumStat(repo, fromHash, hash)
	]);
	return {
		hash: parts[0],
		parents,
		author: parts[2],
		email: parts[3],
		date: parseInt(parts[4], 10),
		committer: parts[5],
		committerEmail: parts[6],
		committerDate: parseInt(parts[7], 10),
		body: (parts.slice(8).join(LOG_SEP) || '').replace(/\n+$/, ''),
		fileChanges: mergeFileChanges(nameStatus, numStat, null),
		fromHash: parents[0] || hash,
		toHash: hash
	};
}

export async function getCommitComparison(repo: string, fromHash: string, toHash: string) {
	const toUncommitted = toHash === UNCOMMITTED;
	const [nameStatus, numStat, status] = await Promise.all([
		getDiffNameStatus(repo, fromHash, toUncommitted ? UNCOMMITTED : toHash),
		getDiffNumStat(repo, fromHash, toUncommitted ? UNCOMMITTED : toHash),
		toUncommitted ? getStatusFiles(repo) : Promise.resolve(null)
	]);
	return {
		fromHash,
		toHash,
		fileChanges: mergeFileChanges(nameStatus, numStat, status)
	};
}

function assertInsideRepo(repo: string, filePath: string) {
	const root = path.resolve(repo);
	const resolved = path.resolve(repo, filePath);
	const prefix = root.endsWith(path.sep) ? root : root + path.sep;
	if (resolved !== root && !resolved.startsWith(prefix)) {
		throw new GitError('Path is outside the repository');
	}
	return resolved;
}

function assertRealPathInsideRepo(repo: string, realFile: string) {
	const root = path.resolve(repo);
	const prefix = root.endsWith(path.sep) ? root : root + path.sep;
	if (realFile !== root && !realFile.startsWith(prefix)) {
		throw new GitError('Path is outside the repository');
	}
}

async function readWorkingTreeFile(repo: string, filePath: string) {
	const abs = assertInsideRepo(repo, filePath);
	let st;
	try {
		st = await fs.lstat(abs);
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT') return '';
		throw err;
	}
	if (st.isSymbolicLink()) {
		return fs.readlink(abs);
	}
	if (!st.isFile()) return '';
	const realFile = await fs.realpath(abs);
	const realRoot = await fs.realpath(repo);
	assertRealPathInsideRepo(realRoot, realFile);
	return fs.readFile(realFile, 'utf8');
}

function isMissingFileAtRevision(message: string) {
	return /does not exist in|exists on disk, but not in|is in the index, but not at|did not match any files|exists on disk, but not in '/i.test(
		message
	);
}

/**
 * File contents at a revision. Empty string if the file does not exist
 * on that side (add/delete). UNCOMMITTED / empty rev reads the working tree.
 * Invalid revisions and I/O errors other than missing files are thrown.
 */
export async function getFileAtRevision(repo: string, rev: string, filePath: string) {
	if (!filePath) throw new GitError('file path is required');
	assertInsideRepo(repo, filePath);
	if (!rev || rev === UNCOMMITTED) {
		return readWorkingTreeFile(repo, filePath);
	}
	try {
		return await runGit(repo, ['show', `${rev}:${filePath}`]);
	} catch (err) {
		if (isMissingFileAtRevision(err instanceof Error ? err.message : String(err))) return '';
		throw err;
	}
}

/**
 * Both sides of a file diff. Empty side for add/delete; working-tree for uncommitted.
 */
export async function getFileDiffSides(
	repo: string,
	spec: {
		status?: string;
		oldFilePath?: string;
		newFilePath?: string;
		path?: string;
		filePath?: string;
		fromHash?: string;
		toHash?: string;
	}
) {
	const status = spec.status || 'M';
	const fromHash = spec.fromHash || '';
	const toHash = spec.toHash || '';
	const leftPath = spec.oldFilePath || spec.path || spec.filePath || '';
	const rightPath = spec.newFilePath || spec.path || spec.filePath || '';
	let left = '';
	let right = '';
	if (status !== 'A' && status !== 'U') {
		left = await getFileAtRevision(repo, fromHash, leftPath);
	}
	if (status !== 'D') {
		right = await getFileAtRevision(repo, toHash, rightPath);
	}
	return {
		left: { rev: fromHash, path: leftPath, content: left },
		right: { rev: toHash === UNCOMMITTED ? 'Working Tree' : toHash, path: rightPath, content: right },
		status
	};
}

export function assertSafeText(value: unknown, label: string): asserts value is string {
	if (!value || typeof value !== 'string') throw new GitError(`${label} is required`);
	if (/[\0\n\r]/.test(value)) throw new GitError(`invalid ${label}`);
}

export function assertSafeRef(value: unknown, label: string): asserts value is string {
	assertSafeText(value, label);
	if (value.startsWith('-')) throw new GitError(`invalid ${label}`);
}
