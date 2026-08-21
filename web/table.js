import { UNCOMMITTED } from './constants.js';
import { els } from './dom.js';
import { escapeHtml } from './escape.js';
import { abbrev, colourVar, formatDate } from './format.js';
import { renderGraph } from './graph.js';
import { state } from './state.js';

const ICON_BRANCH =
	'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="16" viewBox="0 0 10 16"><path fill-rule="evenodd" d="M10 5c0-1.11-.89-2-2-2a1.993 1.993 0 0 0-1 3.72v.3c-.02.52-.23.98-.63 1.38-.4.4-.86.61-1.38.63-.83.02-1.48.16-2 .45V4.72a1.993 1.993 0 0 0-1-3.72C.88 1 0 1.89 0 3a2 2 0 0 0 1 1.72v6.56c-.59.35-1 .99-1 1.72 0 1.11.89 2 2 2 1.11 0 2-.89 2-2 0-.53-.2-1-.53-1.36.09-.06.48-.41.59-.47.25-.11.56-.17.94-.17 1.05-.05 1.95-.45 2.75-1.25S8.95 7.77 9 6.73h-.02C9.59 6.37 10 5.73 10 5zM2 1.8c.66 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2C1.35 4.2.8 3.65.8 3c0-.65.55-1.2 1.2-1.2zm0 12.41c-.66 0-1.2-.55-1.2-1.2 0-.65.55-1.2 1.2-1.2.65 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2zm6-8c-.66 0-1.2-.55-1.2-1.2 0-.65.55-1.2 1.2-1.2.65 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2z"/></svg>';
const ICON_TAG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 15 16"><path fill-rule="evenodd" d="M7.73 1.73C7.26 1.26 6.62 1 5.96 1H3.5C2.13 1 1 2.13 1 3.5v2.47c0 .66.27 1.3.73 1.77l6.06 6.06c.39.39 1.02.39 1.41 0l4.59-4.59a.996.996 0 0 0 0-1.41L7.73 1.73zM2.38 7.09c-.31-.3-.47-.7-.47-1.13V3.5c0-.88.72-1.59 1.59-1.59h2.47c.42 0 .83.16 1.13.47l6.14 6.13-4.73 4.73-6.13-6.15zM3.01 3h2v2H3V3h.01z"/></svg>';

let selectHandler = async () => {};

export function setOnSelect(fn) {
	selectHandler = fn;
}

export function combinedRefs(commit) {
	const headSet = new Set(commit.heads);
	const combined = {};
	const remotes = [];
	for (const r of commit.remotes || []) {
		const slash = r.name.indexOf('/');
		const remote = slash >= 0 ? r.name.slice(0, slash) : r.remote;
		const branch = slash >= 0 ? r.name.slice(slash + 1) : r.name;
		if (headSet.has(branch)) {
			(combined[branch] ||= []).push(remote);
		} else {
			remotes.push(r.name);
		}
	}
	return { combined, remotes };
}

export function refHtml(commit, colourIndex) {
	const { combined, remotes } = combinedRefs(commit);
	let html = '';
	for (const name of commit.heads || []) {
		const active = name === state.branch;
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

export function expandedIndex() {
	if (!state.selected.length) return -1;
	return state.commits.findIndex((c) => c.hash === state.selected[0]);
}

export function drawGraph() {
	if (!state.layout) return;
	const expandAt = document.getElementById('cdvRow') ? expandedIndex() : -1;
	const expandY = expandAt >= 0 ? document.getElementById('cdv')?.offsetHeight || 280 : 0;
	renderGraph(
		els.graph,
		state.layout,
		(id, ev) => {
			const commit = state.commits[id];
			if (commit) selectHandler(commit.hash, ev);
		},
		{ at: expandAt, y: expandY }
	);
}

export function renderTable() {
	const vertices = state.layout?.vertices || [];
	const graphWidth = Math.max(state.layout?.graphWidth || 48, 88);
	els.graphCols.forEach((col) => {
		col.style.width = `${graphWidth}px`;
	});

	els.rows.innerHTML = state.commits
		.map((commit, i) => {
			const v = vertices[i];
			const colourIndex = v ? v.colour : 0;
			const selected = state.selected.includes(commit.hash);
			const isCompare = state.selected.length === 2 && selected;
			const current = commit.hash === state.head || commit.hash === UNCOMMITTED;
			const dot =
				commit.hash === state.head
					? `<span class="commitHeadDot" style="--git-graph-color:${colourVar(colourIndex)}"></span>`
					: '';
			const refs = refHtml(commit, colourIndex);
			const cls = [
				'commit',
				current ? 'current' : '',
				selected ? 'selected' : '',
				isCompare && commit.hash === state.selected[1] ? 'compare' : '',
				commit.stash ? 'stash' : ''
			]
				.filter(Boolean)
				.join(' ');
			const hashLabel = commit.hash === UNCOMMITTED ? '*' : abbrev(commit.hash);
			const findCls =
				state.findHits.includes(i) && state.findIndex >= 0 && state.findHits[state.findIndex] === i
					? ' find-hit find-current'
					: state.findHits.includes(i)
						? ' find-hit'
						: '';
			return `<tr class="${cls}${findCls}" data-id="${i}" data-hash="${escapeHtml(commit.hash)}" data-color="${colourIndex}">
				<td class="graph-cell"></td>
				<td><span class="description">${dot}${refs}<span class="text">${escapeHtml(commit.message)}</span></span></td>
				<td class="date-col">${escapeHtml(formatDate(commit.date))}</td>
				<td class="author-col">${escapeHtml(commit.author || '')}</td>
				<td class="hash-col" title="${escapeHtml(commit.hash)}">${hashLabel}</td>
			</tr>`;
		})
		.join('');

	if (els.loadMore) {
		els.loadMore.hidden = !state.moreCommitsAvailable;
	}
	drawGraph();
}

export function fillBranchFilter(branches) {
	if (!els.branchFilter) return;
	const current = state.branchFilter;
	els.branchFilter.innerHTML =
		'<option value="">Show All</option>' +
		(branches || []).map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
	els.branchFilter.value = current;
}

export function commitsQuery() {
	const params = new URLSearchParams();
	params.set('max', String(state.maxCommits));
	params.set('remotes', state.showRemotes ? '1' : '0');
	params.set('stashes', state.showStashes ? '1' : '0');
	if (state.branchFilter) params.set('branches', state.branchFilter);
	return `/api/commits?${params.toString()}`;
}
