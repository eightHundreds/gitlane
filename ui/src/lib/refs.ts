import { escapeHtml } from '@gitlane/escape';
import type { Commit } from '@gitlane/types';
import { colourVar } from './format';
import { app } from './state.svelte';

const ICON_BRANCH =
	'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="16" viewBox="0 0 10 16"><path fill-rule="evenodd" d="M10 5c0-1.11-.89-2-2-2a1.993 1.993 0 0 0-1 3.72v.3c-.02.52-.23.98-.63 1.38-.4.4-.86.61-1.38.63-.83.02-1.48.16-2 .45V4.72a1.993 1.993 0 0 0-1-3.72C.88 1 0 1.89 0 3a2 2 0 0 0 1 1.72v6.56c-.59.35-1 .99-1 1.72 0 1.11.89 2 2 2 1.11 0 2-.89 2-2 0-.53-.2-1-.53-1.36.09-.06.48-.41.59-.47.25-.11.56-.17.94-.17 1.05-.05 1.95-.45 2.75-1.25S8.95 7.77 9 6.73h-.02C9.59 6.37 10 5.73 10 5zM2 1.8c.66 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2C1.35 4.2.8 3.65.8 3c0-.65.55-1.2 1.2-1.2zm0 12.41c-.66 0-1.2-.55-1.2-1.2 0-.65.55-1.2 1.2-1.2.65 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2zm6-8c-.66 0-1.2-.55-1.2-1.2 0-.65.55-1.2 1.2-1.2.65 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2z"/></svg>';
const ICON_TAG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 15 16"><path fill-rule="evenodd" d="M7.73 1.73C7.26 1.26 6.62 1 5.96 1H3.5C2.13 1 1 2.13 1 3.5v2.47c0 .66.27 1.3.73 1.77l6.06 6.06c.39.39 1.02.39 1.41 0l4.59-4.59a.996.996 0 0 0 0-1.41L7.73 1.73zM2.38 7.09c-.31-.3-.47-.7-.47-1.13V3.5c0-.88.72-1.59 1.59-1.59h2.47c.42 0 .83.16 1.13.47l6.14 6.13-4.73 4.73-6.13-6.15zM3.01 3h2v2H3V3h.01z"/></svg>';

export function combinedRefs(commit: Commit) {
	const headSet = new Set(commit.heads);
	const combined: Record<string, string[]> = {};
	const remotes: string[] = [];
	for (const r of commit.remotes || []) {
		const slash = r.name.indexOf('/');
		const remote = slash >= 0 ? r.name.slice(0, slash) : r.remote;
		const branch = slash >= 0 ? r.name.slice(slash + 1) : r.name;
		if (headSet.has(branch)) {
			(combined[branch] ||= []).push(remote || '');
		} else {
			remotes.push(r.name);
		}
	}
	return { combined, remotes };
}

export function refHtml(commit: Commit, colourIndex: number) {
	const { combined, remotes } = combinedRefs(commit);
	let html = '';
	for (const name of commit.heads || []) {
		const active = name === app.branch;
		const rem = (combined[name] || [])
			.map((r) => {
				const full = `${r}/${name}`;
				return `<span class="gitRef gitRefHeadRemote" data-ref-type="remote" data-name="${escapeHtml(full)}">${escapeHtml(r)}</span>`;
			})
			.join('');
		html += `<span class="gitRef head${active ? ' active' : ''}" data-ref-type="head" data-name="${escapeHtml(name)}" style="--git-graph-color:${colourVar(colourIndex)}">${ICON_BRANCH}<span class="gitRefName">${escapeHtml(name)}</span>${rem}</span>`;
	}
	for (const name of remotes) {
		html += `<span class="gitRef remote" data-ref-type="remote" data-name="${escapeHtml(name)}" style="--git-graph-color:${colourVar(colourIndex)}">${ICON_BRANCH}<span class="gitRefName">${escapeHtml(name)}</span></span>`;
	}
	for (const tag of commit.tags || []) {
		html += `<span class="gitRef tag" data-ref-type="tag" data-name="${escapeHtml(tag.name)}" data-annotated="${tag.annotated ? '1' : '0'}">${ICON_TAG}<span class="gitRefName">${escapeHtml(tag.name)}</span></span>`;
	}
	if (commit.stash) {
		html += `<span class="gitRef stash" data-ref-type="stash" data-name="${escapeHtml(commit.stash.selector)}">${ICON_BRANCH}<span class="gitRefName">${escapeHtml(commit.stash.selector)}</span></span>`;
	}
	return html;
}
