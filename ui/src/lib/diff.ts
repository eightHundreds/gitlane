import { UNCOMMITTED } from '@gitlane/constants';
import type { FileChange } from '@gitlane/types';
import { api } from './api';
import { abbrev } from './format';
import { clearError, showError } from './overlays.svelte';
import { monacoThemeName } from './theme';

const els = {
	get diffOverlay() {
		return document.getElementById('diffOverlay') as HTMLElement;
	},
	get diffDrawer() {
		return document.getElementById('diffDrawer') as HTMLElement;
	},
	get diffFull() {
		return document.getElementById('diffFull') as HTMLButtonElement;
	},
	get diffClose() {
		return document.getElementById('diffClose') as HTMLButtonElement;
	},
	get diffBackdrop() {
		return document.getElementById('diffBackdrop') as HTMLElement;
	},
	get diffTitle() {
		return document.getElementById('diffTitle') as HTMLElement;
	},
	get monacoHost() {
		return document.getElementById('monacoHost') as HTMLElement;
	}
};

const editorState: { diffEditor: { dispose: () => void; layout: () => void; setModel?: (m: unknown) => void } | null; models: { dispose: () => void }[] } = {
	diffEditor: null,
	models: []
};

const MODE = { closed: 'closed', sheet: 'sheet', fullscreen: 'fullscreen' };

function langFromPath(filePath: string) {
	const ext = (filePath.split('.').pop() || '').toLowerCase();
	const map = {
		js: 'javascript',
		mjs: 'javascript',
		cjs: 'javascript',
		ts: 'typescript',
		tsx: 'typescript',
		jsx: 'javascript',
		json: 'json',
		md: 'markdown',
		css: 'css',
		html: 'html',
		htm: 'html',
		py: 'python',
		rb: 'ruby',
		go: 'go',
		rs: 'rust',
		java: 'java',
		kt: 'kotlin',
		c: 'c',
		h: 'c',
		cpp: 'cpp',
		cc: 'cpp',
		sh: 'shell',
		yml: 'yaml',
		yaml: 'yaml',
		xml: 'xml',
		sql: 'sql'
	};
	return map[ext] || 'plaintext';
}

function loadMonaco() {
	if (window.monaco) return Promise.resolve(window.monaco);
	return new Promise((resolve, reject) => {
		if (typeof window.require !== 'function') {
			reject(new Error('Monaco loader is missing'));
			return;
		}
		window.require(['vs/editor/editor.main'], () => {
			window.monaco.editor.defineTheme('gitgraph-dark', {
				base: 'vs-dark',
				inherit: true,
				rules: [],
				colors: {
					'editor.background': '#1e1e1e',
					'editor.foreground': '#d4d4d4',
					'diffEditor.insertedTextBackground': '#2ea04340',
					'diffEditor.removedTextBackground': '#f8514940'
				}
			});
			window.monaco.editor.defineTheme('gitgraph-light', {
				base: 'vs',
				inherit: true,
				rules: [],
				colors: {
					'editor.background': '#ffffff',
					'editor.foreground': '#333333',
					'diffEditor.insertedTextBackground': '#2ea04333',
					'diffEditor.removedTextBackground': '#f8514933'
				}
			});
			window.monaco.editor.setTheme(monacoThemeName());
			resolve(window.monaco);
		});
	});
}

function disposeEditors() {
	if (editorState.diffEditor) {
		editorState.diffEditor.dispose();
		editorState.diffEditor = null;
	}
	for (const m of editorState.models) m.dispose();
	editorState.models = [];
	els.monacoHost?.replaceChildren();
}

function layoutDiffEditor() {
	editorState.diffEditor?.layout?.();
}

function reducedMotion() {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let mode = MODE.closed;
let closing = null;
let loadSeq = 0;

function syncFullButton() {
	const full = mode === MODE.fullscreen;
	if (!els.diffFull) return;
	els.diffFull.textContent = full ? 'Exit full screen' : 'Full screen';
	els.diffFull.title = full ? 'Exit full screen' : 'Full screen';
	els.diffFull.setAttribute('aria-pressed', full ? 'true' : 'false');
}

function cancelClosing() {
	if (!closing) return;
	els.diffDrawer?.removeEventListener('transitionend', closing.onEnd);
	clearTimeout(closing.timer);
	closing = null;
}

function finishClose() {
	if (mode !== MODE.closed) return;
	cancelClosing();
	els.diffOverlay.classList.remove('fullscreen');
	els.diffOverlay.hidden = true;
	syncFullButton();
	disposeEditors();
}

function applyMode(next) {
	const overlay = els.diffOverlay;
	const drawer = els.diffDrawer;
	const prev = mode;

	if (next === MODE.closed) {
		if (prev === MODE.closed) {
			if (overlay.hidden) disposeEditors();
			return;
		}
		mode = MODE.closed;
		overlay.classList.remove('open');
		syncFullButton();
		if (reducedMotion()) {
			finishClose();
			return;
		}
		const onEnd = (ev) => {
			if (ev.target !== drawer || ev.propertyName !== 'transform') return;
			finishClose();
		};
		drawer.addEventListener('transitionend', onEnd);
		closing = {
			onEnd,
			timer: window.setTimeout(finishClose, 400)
		};
		return;
	}

	cancelClosing();
	mode = next;
	overlay.hidden = false;
	overlay.classList.toggle('fullscreen', next === MODE.fullscreen);
	if (prev === MODE.closed) {
		overlay.classList.remove('open');
		void overlay.offsetWidth;
	}
	overlay.classList.add('open');
	syncFullButton();
	requestAnimationFrame(layoutDiffEditor);
	if (prev !== next && (prev === MODE.fullscreen || next === MODE.fullscreen) && !reducedMotion()) {
		const onEnd = (ev) => {
			if (ev.target !== drawer || ev.propertyName !== 'height') return;
			drawer.removeEventListener('transitionend', onEnd);
			layoutDiffEditor();
		};
		drawer.addEventListener('transitionend', onEnd);
	}
}

function showDrawer() {
	if (mode === MODE.sheet || mode === MODE.fullscreen) {
		requestAnimationFrame(layoutDiffEditor);
		return;
	}
	applyMode(MODE.sheet);
}

function presentInDrawer(title, mount) {
	els.diffTitle.textContent = title;
	disposeEditors();
	showDrawer();
	mount();
}

export function closeDiff() {
	applyMode(MODE.closed);
}

export function isDiffDrawerOpen() {
	return mode === MODE.sheet || mode === MODE.fullscreen;
}

export function handleDiffEscape(ev) {
	if (ev.key !== 'Escape') return false;
	if (mode === MODE.fullscreen) {
		ev.preventDefault();
		applyMode(MODE.sheet);
		return true;
	}
	if (mode === MODE.sheet) {
		ev.preventDefault();
		applyMode(MODE.closed);
		return true;
	}
	if (els.diffOverlay && !els.diffOverlay.hidden) {
		ev.preventDefault();
		return true;
	}
	return false;
}

export function bindDiffOverlay() {
	if (els.diffOverlay) els.diffOverlay.hidden = true;
	els.diffClose.addEventListener('click', closeDiff);
	els.diffFull.addEventListener('click', () => {
		if (mode === MODE.fullscreen) applyMode(MODE.sheet);
		else if (mode === MODE.sheet) applyMode(MODE.fullscreen);
	});
	els.diffBackdrop.addEventListener('click', closeDiff);
}

export async function openDiff(file: FileChange, fromHash: string | null, toHash: string | null) {
	const seq = ++loadSeq;
	const params = new URLSearchParams({
		from: fromHash || '',
		to: toHash || '',
		path: file.newFilePath,
		oldPath: file.oldFilePath || file.newFilePath,
		status: file.type
	});
	try {
		const data = await api(`/api/diff?${params.toString()}`);
		if (seq !== loadSeq) return;
		clearError();
		const monaco = await loadMonaco();
		if (seq !== loadSeq) return;
		const fromLabel = abbrev(fromHash) || '∅';
		const toLabel = toHash === UNCOMMITTED ? 'Working Tree' : abbrev(toHash);
		presentInDrawer(`${file.type}  ${file.newFilePath}   ${fromLabel} → ${toLabel}`, () => {
			const lang = langFromPath(file.newFilePath);
			const original = monaco.editor.createModel(data.left.content, lang);
			const modified = monaco.editor.createModel(data.right.content, lang);
			editorState.models = [original, modified];
			editorState.diffEditor = monaco.editor.createDiffEditor(els.monacoHost, {
				theme: monacoThemeName(),
				readOnly: true,
				automaticLayout: true,
				renderSideBySide: true,
				originalEditable: false,
				minimap: { enabled: false },
				ignoreTrimWhitespace: false,
				renderIndicators: true
			});
			editorState.diffEditor.setModel({ original, modified });
			editorState.diffEditor.layout();
		});
	} catch (err) {
		if (seq !== loadSeq) return;
		showError(err.message);
	}
}

export async function openFileAtRevision(file: FileChange, rev: string | null) {
	const seq = ++loadSeq;
	try {
		const data = await api(
			`/api/file?rev=${encodeURIComponent(rev || '')}&path=${encodeURIComponent(file.newFilePath)}`
		);
		if (seq !== loadSeq) return;
		clearError();
		const monaco = await loadMonaco();
		if (seq !== loadSeq) return;
		const label = rev === UNCOMMITTED ? 'Working Tree' : abbrev(rev);
		presentInDrawer(`${file.newFilePath} @ ${label}`, () => {
			const model = monaco.editor.createModel(data.content, langFromPath(file.newFilePath));
			editorState.models = [model];
			const editor = monaco.editor.create(els.monacoHost, {
				model,
				theme: monacoThemeName(),
				readOnly: true,
				automaticLayout: true,
				minimap: { enabled: false }
			});
			editorState.diffEditor = editor;
			editor.layout();
		});
	} catch (err) {
		if (seq !== loadSeq) return;
		showError(err.message);
	}
}
