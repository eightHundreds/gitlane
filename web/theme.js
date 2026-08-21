const STORAGE_KEY = 'gitlane-theme';

export function resolvedTheme() {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'light' || stored === 'dark') return stored;
	} catch {
		/* private mode */
	}
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function monacoThemeName(theme = resolvedTheme()) {
	return theme === 'light' ? 'gitgraph-light' : 'gitgraph-dark';
}

function syncThemeButton(theme) {
	const btn = document.getElementById('themeBtn');
	if (!btn) return;
	const next = theme === 'light' ? 'dark' : 'light';
	btn.textContent = next === 'light' ? 'Light' : 'Dark';
	btn.title = `Switch to ${next} theme`;
	btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
}

export function applyTheme(theme = resolvedTheme()) {
	document.documentElement.setAttribute('data-theme', theme);
	document.documentElement.style.colorScheme = theme;
	if (window.monaco?.editor) {
		window.monaco.editor.setTheme(monacoThemeName(theme));
	}
	syncThemeButton(theme);
}

export function toggleTheme() {
	const next = resolvedTheme() === 'light' ? 'dark' : 'light';
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		/* private mode */
	}
	applyTheme(next);
}

export function initTheme() {
	applyTheme();
	const mq = window.matchMedia('(prefers-color-scheme: light)');
	const onChange = () => {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored === 'light' || stored === 'dark') return;
		} catch {
			/* private mode */
		}
		applyTheme();
	};
	if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
	else mq.addListener(onChange);
}
