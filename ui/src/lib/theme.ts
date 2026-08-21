const STORAGE_KEY = 'gitlane-theme';

export function resolvedTheme(): 'light' | 'dark' {
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

export function applyTheme(theme = resolvedTheme()) {
	document.documentElement.setAttribute('data-theme', theme);
	document.documentElement.style.colorScheme = theme;
	window.monaco?.editor?.setTheme(monacoThemeName(theme));
}

export function toggleTheme() {
	const next = resolvedTheme() === 'light' ? 'dark' : 'light';
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		/* private mode */
	}
	applyTheme(next);
	return next;
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
