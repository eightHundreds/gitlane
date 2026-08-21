import { escapeHtml } from './escape.js';

export function fileLabel(f) {
	return f.type === 'R' ? `${f.oldFilePath} → ${f.newFilePath}` : f.newFilePath;
}

export function fileStatHtml(f) {
	if (f.additions == null && f.deletions == null) return '';
	return `<span class="file-stat">+${f.additions ?? 0} −${f.deletions ?? 0}</span>`;
}

export function fileRowHtml(f, index, label) {
	return `<div class="file-row gitDiffPossible" data-i="${index}">
				<span class="file-type ${f.type}">${f.type}</span>
				<span>${escapeHtml(label)}</span>${fileStatHtml(f)}
			</div>`;
}
