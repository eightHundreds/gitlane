export const els = {
	repoLabel: document.getElementById('repoLabel'),
	branchLabel: document.getElementById('branchLabel'),
	refreshBtn: document.getElementById('refreshBtn'),
	themeBtn: document.getElementById('themeBtn'),
	fetchBtn: document.getElementById('fetchBtn'),
	findBtn: document.getElementById('findBtn'),
	findBar: document.getElementById('findBar'),
	findInput: document.getElementById('findInput'),
	findCount: document.getElementById('findCount'),
	findPrev: document.getElementById('findPrev'),
	findNext: document.getElementById('findNext'),
	findClose: document.getElementById('findClose'),
	branchFilter: document.getElementById('branchFilter'),
	showRemotes: document.getElementById('showRemotes'),
	showStashes: document.getElementById('showStashes'),
	loadMore: document.getElementById('loadMore'),
	loadMoreBtn: document.getElementById('loadMoreBtn'),
	graph: document.getElementById('commitGraph'),
	rows: document.getElementById('commitRows'),
	graphCols: document.querySelectorAll('.graph-col, #graphCol'),
	cdv: null,
	cdvSummary: null,
	cdvFiles: null,
	errorBanner: document.getElementById('errorBanner'),
	contextMenu: document.getElementById('contextMenu'),
	dialog: document.getElementById('dialog'),
	dialogTitle: document.getElementById('dialogTitle'),
	dialogBody: document.getElementById('dialogBody'),
	dialogOk: document.getElementById('dialogOk'),
	dialogCancel: document.getElementById('dialogCancel'),
	diffOverlay: document.getElementById('diffOverlay'),
	diffTitle: document.getElementById('diffTitle'),
	diffClose: document.getElementById('diffClose'),
	monacoHost: document.getElementById('monacoHost')
};

export function showError(message) {
	const text = String(message || 'Request failed');
	els.errorBanner.hidden = false;
	els.errorBanner.textContent = text;
}

export function clearError() {
	els.errorBanner.hidden = true;
	els.errorBanner.textContent = '';
}

export function bindCdvEls() {
	els.cdv = document.getElementById('cdv');
	els.cdvSummary = document.getElementById('cdvSummary');
	els.cdvFiles = document.getElementById('cdvFiles');
}

export function nextFrame() {
	return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export function fieldValue(id) {
	return document.getElementById(id)?.value ?? '';
}

export function fieldChecked(id) {
	return Boolean(document.getElementById(id)?.checked);
}
