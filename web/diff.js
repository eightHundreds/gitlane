import { UNCOMMITTED } from './constants.js';
import { api } from './api.js';
import { els, nextFrame, showError, clearError } from './dom.js';
import { abbrev } from './format.js';
import { state } from './state.js';
import { monacoThemeName } from './theme.js';

function langFromPath(filePath) {
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

export function disposeEditors() {
	if (state.diffEditor) {
		state.diffEditor.dispose();
		state.diffEditor = null;
	}
	for (const m of state.models) m.dispose();
	state.models = [];
	els.monacoHost.replaceChildren();
}

export function closeDiff() {
	els.diffOverlay.hidden = true;
	disposeEditors();
}

export async function openDiff(file, fromHash, toHash) {
	const params = new URLSearchParams({
		from: fromHash || '',
		to: toHash || '',
		path: file.newFilePath,
		oldPath: file.oldFilePath || file.newFilePath,
		status: file.type
	});
	try {
		const data = await api(`/api/diff?${params.toString()}`);
		clearError();
		const monaco = await loadMonaco();
		const fromLabel = abbrev(fromHash) || '∅';
		const toLabel = toHash === UNCOMMITTED ? 'Working Tree' : abbrev(toHash);
		els.diffTitle.textContent = `${file.type}  ${file.newFilePath}   ${fromLabel} → ${toLabel}`;
		disposeEditors();
		els.diffOverlay.hidden = false;
		await nextFrame();

		const lang = langFromPath(file.newFilePath);
		const original = monaco.editor.createModel(data.left.content, lang);
		const modified = monaco.editor.createModel(data.right.content, lang);
		state.models = [original, modified];
		state.diffEditor = monaco.editor.createDiffEditor(els.monacoHost, {
			theme: monacoThemeName(),
			readOnly: true,
			automaticLayout: true,
			renderSideBySide: true,
			originalEditable: false,
			minimap: { enabled: false },
			ignoreTrimWhitespace: false,
			renderIndicators: true
		});
		state.diffEditor.setModel({ original, modified });
		state.diffEditor.layout();
	} catch (err) {
		showError(err.message);
	}
}

export async function openFileAtRevision(file, rev) {
	try {
		const data = await api(
			`/api/file?rev=${encodeURIComponent(rev || '')}&path=${encodeURIComponent(file.newFilePath)}`
		);
		clearError();
		const monaco = await loadMonaco();
		disposeEditors();
		els.diffOverlay.hidden = false;
		els.diffTitle.textContent = `${file.newFilePath} @ ${rev === UNCOMMITTED ? 'Working Tree' : abbrev(rev)}`;
		await nextFrame();
		const model = monaco.editor.createModel(data.content, langFromPath(file.newFilePath));
		state.models = [model];
		const editor = monaco.editor.create(els.monacoHost, {
			model,
			theme: monacoThemeName(),
			readOnly: true,
			automaticLayout: true,
			minimap: { enabled: false }
		});
		state.diffEditor = editor;
		editor.layout();
	} catch (err) {
		showError(err.message);
	}
}
