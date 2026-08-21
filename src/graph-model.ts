import { UNCOMMITTED } from './constants.js';
import { layoutGraph } from './layout.js';
import type { Commit, GraphLayout, StashMeta, StashRecord } from './types.js';

export type RepoRefs = {
	head: string | null;
	heads: { hash: string; name: string }[];
	tags: { hash: string; name: string; annotated: boolean }[];
	remotes: { hash: string; name: string }[];
};

export function commitRow(fields: {
	hash: string;
	parents?: string[];
	author?: string;
	email?: string;
	date?: number;
	message?: string;
	stash?: StashMeta | null;
	heads?: string[];
	tags?: Commit['tags'];
	remotes?: Commit['remotes'];
}): Commit {
	return {
		hash: fields.hash,
		parents: fields.parents || [],
		author: fields.author || '',
		email: fields.email || '',
		date: fields.date || 0,
		message: fields.message || '',
		heads: fields.heads ? fields.heads.slice() : [],
		tags: fields.tags ? fields.tags.map((t) => ({ ...t })) : [],
		remotes: fields.remotes ? fields.remotes.map((r) => ({ ...r })) : [],
		stash: fields.stash ?? null
	};
}

function stashMeta(stash: StashRecord): StashMeta {
	return { selector: stash.selector, baseHash: stash.baseHash };
}

function stashCommit(stash: StashRecord) {
	return commitRow({
		hash: stash.hash,
		parents: stash.baseHash ? [stash.baseHash] : [],
		author: stash.author,
		email: stash.email,
		date: stash.date,
		message: stash.message,
		stash: stashMeta(stash)
	});
}

/**
 * Newest-first log plus stash rows sitting immediately above their base.
 * Stashes whose hash is already in the log are annotated in place.
 * Stashes whose base is not in the log are dropped.
 */
export function insertStashes(
	logCommits: Array<Partial<Commit> & { hash: string }>,
	stashList: StashRecord[],
	uncommittedRow: Commit | null = null
): Commit[] {
	const inLog = new Set(logCommits.map((c) => c.hash));
	const stashByHash = new Map<string, StashRecord>();
	const byBase = new Map<string, StashRecord[]>();
	for (const stash of stashList || []) {
		stashByHash.set(stash.hash, stash);
		if (!stash.baseHash) continue;
		const group = byBase.get(stash.baseHash);
		if (group) group.push(stash);
		else byBase.set(stash.baseHash, [stash]);
	}
	for (const group of byBase.values()) {
		group.sort((a, b) => b.date - a.date);
	}
	const out: Commit[] = [];
	if (uncommittedRow) out.push(uncommittedRow);
	for (const commit of logCommits) {
		for (const stash of byBase.get(commit.hash) || []) {
			if (inLog.has(stash.hash)) continue;
			out.push(stashCommit(stash));
		}
		const meta = stashByHash.get(commit.hash);
		if (meta) {
			out.push(
				commitRow({
					...commit,
					hash: commit.hash,
					parents: meta.baseHash ? [meta.baseHash] : commit.parents,
					stash: stashMeta(meta)
				})
			);
		} else {
			out.push(commitRow({ ...commit, hash: commit.hash }));
		}
	}
	return out;
}

export function attachRefs(
	commits: Commit[],
	refs: RepoRefs,
	opts: { showTags?: boolean; showRemoteBranches?: boolean } = {}
): Commit[] {
	const showTags = opts.showTags !== false;
	const showRemoteBranches = opts.showRemoteBranches !== false;
	const lookup = Object.fromEntries(commits.map((c, i) => [c.hash, i]));
	for (const h of refs.heads) {
		if (typeof lookup[h.hash] === 'number') commits[lookup[h.hash]].heads.push(h.name);
	}
	if (showTags) {
		for (const t of refs.tags) {
			if (typeof lookup[t.hash] === 'number') {
				commits[lookup[t.hash]].tags.push({ name: t.name, annotated: t.annotated });
			}
		}
	}
	if (showRemoteBranches) {
		for (const r of refs.remotes) {
			if (typeof lookup[r.hash] === 'number') {
				const slash = r.name.indexOf('/');
				commits[lookup[r.hash]].remotes.push({
					name: r.name,
					remote: slash >= 0 ? r.name.slice(0, slash) : null
				});
			}
		}
	}
	return commits;
}

export function assembleCommitGraph(input: {
	logCommits: Array<Partial<Commit> & { hash: string }>;
	stashList?: StashRecord[];
	uncommittedRow?: Commit | null;
	refs: RepoRefs;
	showTags?: boolean;
	showRemoteBranches?: boolean;
}): { commits: Commit[]; layout: GraphLayout } {
	const commits = insertStashes(input.logCommits, input.stashList || [], input.uncommittedRow ?? null);
	attachRefs(commits, input.refs, {
		showTags: input.showTags,
		showRemoteBranches: input.showRemoteBranches
	});
	return {
		commits,
		layout: layoutGraph(commits, { head: input.refs.head })
	};
}

export function uncommittedCommit(head: string | null, count: number, now = Date.now()): Commit {
	return commitRow({
		hash: UNCOMMITTED,
		parents: head ? [head] : [],
		author: '*',
		date: Math.round(now / 1000),
		message: `Uncommitted Changes (${count})`
	});
}
