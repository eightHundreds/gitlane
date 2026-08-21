import { GRAPH_COLOURS, DEFAULT_MAX_COMMITS, LOAD_MORE_COMMITS } from './constants.js';
import { api } from './api.js';
import { closeCdv, showCompare, showDetails } from './cdv.js';
import { hideMenu } from './dialog.js';
import { closeDiff } from './diff.js';
import { els, showError, clearError } from './dom.js';
import { escapeHtml } from './escape.js';
import { applyFind, closeFind, findStep, openFind } from './find.js';
import { openCommitMenu, openHeadMenu, openRemoteMenu, openStashMenu, openTagMenu } from './menus.js';
import { mutateAndReload, setLoadGraph } from './reload.js';
import { state } from './state.js';
import { commitsQuery, fillBranchFilter, renderTable, setOnSelect } from './table.js';
import { initTheme, toggleTheme } from './theme.js';

function applyGraphColours() {
	GRAPH_COLOURS.forEach((c, i) => {
		document.documentElement.style.setProperty(`--git-graph-color${i}`, c);
	});
}

async function loadGraph() {
	let data;
	try {
		data = await api(commitsQuery());
	} catch (err) {
		showError(err.message);
		throw err;
	}
	clearError();
	state.commits = data.commits;
	state.layout = data.layout;
	state.head = data.head;
	state.branch = data.branch;
	state.repo = data.repo;
	state.moreCommitsAvailable = Boolean(data.moreCommitsAvailable);
	state.maxCommits = data.maxCommits || state.maxCommits;
	state.branches = data.branches || [];
	state.remotes = data.remotes || [];
	els.repoLabel.textContent = data.repo;
	els.branchLabel.textContent = data.detached ? 'HEAD detached' : data.branch || '';
	document.title = `Git Graph — ${data.branch || 'repository'}`;
	fillBranchFilter(state.branches);
	if (els.fetchBtn) els.fetchBtn.hidden = state.remotes.length === 0;
	renderTable();
	applyFind();
	if (state.selected.length === 1) {
		await showDetails(state.selected[0]);
	} else if (state.selected.length === 2) {
		await showCompare(state.selected[0], state.selected[1]);
	}
}

async function onSelect(hash, ev) {
	hideMenu();
	const multi = ev.metaKey || ev.ctrlKey;
	if (!multi && state.selected.length === 1 && state.selected[0] === hash) {
		state.selected = [];
		state.details = null;
		state.compare = null;
		renderTable();
		return;
	}
	if (multi && state.selected.length === 1 && state.selected[0] !== hash) {
		state.selected = [state.selected[0], hash];
		renderTable();
		try {
			await showCompare(state.selected[0], state.selected[1]);
		} catch (err) {
			showError(err.message);
		}
		return;
	}
	state.selected = [hash];
	renderTable();
	try {
		await showDetails(hash);
	} catch (err) {
		showError(err.message);
	}
}

applyGraphColours();
initTheme();
setOnSelect(onSelect);
setLoadGraph(loadGraph);

els.rows.addEventListener('click', (ev) => {
	const parent = ev.target.closest('#cdvSummary .cdvParent');
	if (parent) {
		ev.stopPropagation();
		onSelect(parent.dataset.hash, ev);
		return;
	}
	const tr = ev.target.closest('tr.commit');
	if (!tr) return;
	onSelect(tr.dataset.hash, ev);
});

els.rows.addEventListener('contextmenu', (ev) => {
	const ref = ev.target.closest('.gitRef');
	if (ref) {
		ev.preventDefault();
		const type = ref.dataset.refType;
		const name = ref.dataset.name;
		if (type === 'head') openHeadMenu(ev, name);
		else if (type === 'remote') openRemoteMenu(ev, name);
		else if (type === 'tag') openTagMenu(ev, name, ref.dataset.annotated === '1');
		else if (type === 'stash') {
			const tr = ev.target.closest('tr.commit');
			const commit = tr ? state.commits[Number(tr.dataset.id)] : null;
			if (commit) openStashMenu(ev, commit);
		}
		return;
	}
	const tr = ev.target.closest('tr.commit');
	if (!tr) return;
	const commit = state.commits[Number(tr.dataset.id)];
	if (commit) openCommitMenu(ev, commit);
});

document.addEventListener('click', (ev) => {
	if (!els.contextMenu.contains(ev.target)) hideMenu();
});

els.refreshBtn.addEventListener('click', () => {
	loadGraph().catch(() => {});
});
els.themeBtn?.addEventListener('click', () => {
	toggleTheme();
});
els.fetchBtn?.addEventListener('click', () => {
	mutateAndReload('fetch', { prune: true }).catch((err) => showError(err.message));
});
els.branchFilter?.addEventListener('change', () => {
	state.branchFilter = els.branchFilter.value;
	state.maxCommits = DEFAULT_MAX_COMMITS;
	loadGraph().catch(() => {});
});
els.showRemotes?.addEventListener('change', () => {
	state.showRemotes = els.showRemotes.checked;
	loadGraph().catch(() => {});
});
els.showStashes?.addEventListener('change', () => {
	state.showStashes = els.showStashes.checked;
	loadGraph().catch(() => {});
});
els.loadMoreBtn?.addEventListener('click', () => {
	state.maxCommits += LOAD_MORE_COMMITS;
	loadGraph().catch(() => {});
});

els.findBtn?.addEventListener('click', openFind);
els.findClose?.addEventListener('click', closeFind);
els.findInput?.addEventListener('input', () => {
	state.findIndex = 0;
	applyFind();
});
els.findNext?.addEventListener('click', () => findStep(1));
els.findPrev?.addEventListener('click', () => findStep(-1));

els.diffClose.addEventListener('click', closeDiff);
document.addEventListener('keydown', (ev) => {
	const meta = ev.metaKey || ev.ctrlKey;
	if (meta && ev.key.toLowerCase() === 'f') {
		ev.preventDefault();
		openFind();
		return;
	}
	if (meta && ev.key.toLowerCase() === 'r') {
		ev.preventDefault();
		loadGraph().catch(() => {});
		return;
	}
	if (meta && ev.key.toLowerCase() === 'h') {
		ev.preventDefault();
		const i = state.commits.findIndex((c) => c.hash === state.head);
		if (i >= 0) els.rows.querySelector(`tr.commit[data-id="${i}"]`)?.scrollIntoView({ block: 'center' });
		return;
	}
	if (ev.key === 'Enter' && !els.dialog.hidden) {
		ev.preventDefault();
		els.dialogOk.click();
		return;
	}
	if (ev.key === 'ArrowDown' && state.selected.length === 1 && els.dialog.hidden && els.diffOverlay.hidden) {
		const i = state.commits.findIndex((c) => c.hash === state.selected[0]);
		if (i >= 0 && i + 1 < state.commits.length) onSelect(state.commits[i + 1].hash, { metaKey: false, ctrlKey: false });
		return;
	}
	if (ev.key === 'ArrowUp' && state.selected.length === 1 && els.dialog.hidden && els.diffOverlay.hidden) {
		const i = state.commits.findIndex((c) => c.hash === state.selected[0]);
		if (i > 0) onSelect(state.commits[i - 1].hash, { metaKey: false, ctrlKey: false });
		return;
	}
	if (ev.key === 'Escape') {
		if (!els.diffOverlay.hidden) closeDiff();
		else if (!els.dialog.hidden) els.dialog.hidden = true;
		else if (els.findBar && !els.findBar.hidden) closeFind();
		else if (document.getElementById('cdvRow')) closeCdv();
		else hideMenu();
	}
});

loadGraph().catch((err) => {
	els.rows.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(err.message)}</td></tr>`;
});
