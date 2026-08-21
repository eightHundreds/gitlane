import { GRAPH_COLOURS, UNCOMMITTED } from '@gitlane/constants';
import { escapeHtml } from '@gitlane/escape';
import { clearError, showError } from './overlays.svelte';

export function abbrev(hash: string | null | undefined) {
	if (!hash || hash === UNCOMMITTED) return hash === UNCOMMITTED ? '*' : '';
	return hash.slice(0, 8);
}

export function formatDate(unix: number | null | undefined) {
	if (!unix) return '';
	const d = new Date(unix * 1000);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function colourVar(index: number) {
	return `var(--git-graph-color${index % GRAPH_COLOURS.length})`;
}

export function formatPerson(name: string, email: string) {
	if (!name && !email) return '';
	return email ? `${escapeHtml(name || '')} &lt;${escapeHtml(email)}&gt;` : escapeHtml(name || '');
}

export function linkify(text: string) {
	return escapeHtml(text).replace(
		/https?:\/\/[^\s<]+/g,
		(url) => `<a class="ext-url" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`
	);
}

export async function copyText(text: string, label?: string) {
	try {
		await navigator.clipboard.writeText(text);
		clearError();
	} catch {
		showError(`Could not copy ${label || 'text'}`);
	}
}
