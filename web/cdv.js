import { UNCOMMITTED } from './constants.js';
import { bindCdvEls, els, nextFrame } from './dom.js';
import { api } from './api.js';
import { escapeHtml } from './escape.js';
import { fileLabel, fileRowHtml } from './files.js';
import { filesToTreeHtml } from './filetree.js';
import { formatDate, formatPerson, linkify } from './format.js';
import { openDiff } from './diff.js';
import { openFileMenu } from './menus.js';
import { drawGraph, renderTable } from './table.js';
import { state } from './state.js';

function parentHtml(parents) {
	if (!parents || !parents.length) return 'None';
	return parents
		.map((p) => {
			const known = state.commits.some((c) => c.hash === p);
			const cls = known ? ' class="cdvParent"' : '';
			return `<span${cls} data-hash="${escapeHtml(p)}">${escapeHtml(p)}</span>`;
		})
		.join(', ');
}

function renderCommitMeta(details) {
	const distinctDate =
		Number(details.committerDate) > 0 && Number(details.committerDate) !== Number(details.date);
	const distinctPerson =
		(details.committer && details.committer !== details.author) ||
		(details.committerEmail && details.committerEmail !== details.email);
	const lines = [
		`<div><b>Commit: </b><span class="cdvHash">${escapeHtml(details.hash)}</span></div>`,
		`<div><b>Parents: </b>${parentHtml(details.parents)}</div>`,
		`<div><b>Author: </b>${formatPerson(details.author, details.email)}</div>`
	];
	if (distinctDate) {
		lines.push(`<div><b>Author Date: </b>${escapeHtml(formatDate(details.date))}</div>`);
	} else {
		lines.push(`<div><b>Date: </b>${escapeHtml(formatDate(details.date))}</div>`);
	}
	if (distinctPerson || distinctDate) {
		lines.push(`<div><b>Committer: </b>${formatPerson(details.committer, details.committerEmail)}</div>`);
	}
	if (distinctDate) {
		lines.push(`<div><b>Committer Date: </b>${escapeHtml(formatDate(details.committerDate))}</div>`);
	}
	return `<h3>Commit Details</h3><div class="cdvKeys">${lines.join('')}</div><pre>${linkify(details.body || '')}</pre>`;
}

function cdvControlsHtml() {
	return `<div id="cdvControls">
		<button type="button" id="cdvClose">Close</button>
		<button type="button" id="cdvViewList">List</button>
		<button type="button" id="cdvViewTree">Tree</button>
	</div>`;
}

function bindCdvControls() {
	document.getElementById('cdvClose')?.addEventListener('click', closeCdv);
	document.getElementById('cdvViewList')?.addEventListener('click', () => {
		state.fileView = 'list';
		renderFiles(state.fileChanges, state.fromHash, state.toHash);
	});
	document.getElementById('cdvViewTree')?.addEventListener('click', () => {
		state.fileView = 'tree';
		renderFiles(state.fileChanges, state.fromHash, state.toHash);
	});
}

function insertCdvAfter(index) {
	const tr = els.rows.querySelector(`tr.commit[data-id="${index}"]`);
	if (!tr) return null;
	document.getElementById('cdvRow')?.remove();
	const row = document.createElement('tr');
	row.id = 'cdvRow';
	row.innerHTML =
		'<td class="graph-cell"></td><td colspan="4"><section id="cdv"><div id="cdvSummary"></div><div id="cdvFiles"></div></section></td>';
	tr.after(row);
	tr.classList.add('commitDetailsOpen');
	bindCdvEls();
	return row;
}

export function closeCdv() {
	state.selected = [];
	state.details = null;
	state.compare = null;
	renderTable();
}

export function orderHashes(a, b) {
	const ia = state.commits.findIndex((c) => c.hash === a);
	const ib = state.commits.findIndex((c) => c.hash === b);
	if (a === UNCOMMITTED) return { from: b, to: a };
	if (b === UNCOMMITTED) return { from: a, to: b };
	return ia <= ib ? { from: b, to: a } : { from: a, to: b };
}

export function renderFiles(files, fromHash, toHash) {
	state.fileChanges = files;
	state.fromHash = fromHash;
	state.toHash = toHash;
	if (!files.length) {
		els.cdvFiles.innerHTML = '<div class="empty">No file changes</div>';
		return;
	}
	els.cdvFiles.innerHTML =
		state.fileView === 'tree'
			? filesToTreeHtml(files)
			: files.map((f, i) => fileRowHtml(f, i, fileLabel(f))).join('');
	els.cdvFiles.querySelectorAll('.file-row.gitDiffPossible').forEach((row) => {
		row.addEventListener('click', () => {
			const file = files[Number(row.dataset.i)];
			openDiff(file, fromHash, toHash);
		});
		row.addEventListener('contextmenu', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			const file = files[Number(row.dataset.i)];
			openFileMenu(ev, file, fromHash, toHash);
		});
	});
}

export async function showDetails(hash) {
	const details = await api(`/api/details?hash=${encodeURIComponent(hash)}`);
	state.details = details;
	state.compare = null;
	const index = state.commits.findIndex((c) => c.hash === hash);
	insertCdvAfter(index);
	if (hash === UNCOMMITTED) {
		els.cdvSummary.innerHTML = `${cdvControlsHtml()}<h3>Uncommitted Changes</h3>
			<div class="meta">${escapeHtml(details.body || 'Working tree vs HEAD')}</div>`;
	} else {
		els.cdvSummary.innerHTML = cdvControlsHtml() + renderCommitMeta(details);
	}
	bindCdvControls();
	renderFiles(details.fileChanges || [], details.fromHash, details.toHash);
	await nextFrame();
	drawGraph();
}

export async function showCompare(a, b) {
	const { from, to } = orderHashes(a, b);
	const cmp = await api(`/api/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
	state.compare = cmp;
	state.details = null;
	const index = state.commits.findIndex((c) => c.hash === state.selected[0]);
	insertCdvAfter(index);
	els.cdvSummary.innerHTML = `${cdvControlsHtml()}<h3>Compare</h3>
		<div class="cdvKeys">
			<div><b>From: </b><span class="cdvHash">${escapeHtml(from)}</span></div>
			<div><b>To: </b><span class="cdvHash">${escapeHtml(to === UNCOMMITTED ? 'Working Tree' : to)}</span></div>
		</div>`;
	bindCdvControls();
	renderFiles(cmp.fileChanges || [], from, to);
	await nextFrame();
	drawGraph();
}
