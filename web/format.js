import { GRAPH_COLOURS, UNCOMMITTED } from './constants.js';
import { clearError, showError } from './dom.js';
import { escapeHtml } from './escape.js';

export function abbrev(hash) {
	if (!hash || hash === UNCOMMITTED) return hash === UNCOMMITTED ? '*' : '';
	return hash.slice(0, 8);
}

export function formatDate(unix) {
	if (!unix) return '';
	const d = new Date(unix * 1000);
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function colourVar(index) {
	return `var(--git-graph-color${index % GRAPH_COLOURS.length})`;
}

export function formatPerson(name, email) {
	if (!name && !email) return '';
	return email ? `${escapeHtml(name || '')} &lt;${escapeHtml(email)}&gt;` : escapeHtml(name || '');
}

export function linkify(text) {
	return escapeHtml(text).replace(
		/https?:\/\/[^\s<]+/g,
		(url) => `<a class="ext-url" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`
	);
}

export async function copyText(text, label) {
	try {
		await navigator.clipboard.writeText(text);
		clearError();
	} catch {
		showError(`Could not copy ${label || 'text'}`);
	}
}
