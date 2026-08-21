import { escapeHtml } from './escape.js';
import type { FileChange } from './types.js';

export function fileLabel(f: FileChange) {
	return f.type === 'R' ? `${f.oldFilePath} → ${f.newFilePath}` : f.newFilePath;
}

export function fileStatHtml(f: FileChange) {
	if (f.additions == null && f.deletions == null) return '';
	return `<span class="file-stat">+${f.additions ?? 0} −${f.deletions ?? 0}</span>`;
}

export function fileRowHtml(f: FileChange, index: number, label: string, opts: { depth?: number; tree?: boolean } = {}) {
	const depth = Number(opts.depth) || 0;
	const depthAttr = opts.tree ? ` style="--tree-depth:${depth}"` : '';
	const title = f.newFilePath ? ` title="${escapeHtml(f.newFilePath)}"` : '';
	return `<div class="file-row gitDiffPossible" data-i="${index}"${depthAttr}${title}>
				<span class="file-type ${f.type}">${f.type}</span>
				<span class="tree-name">${escapeHtml(label)}</span>${fileStatHtml(f)}
			</div>`;
}
