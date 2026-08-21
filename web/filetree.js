import { escapeHtml } from './escape.js';
import { fileRowHtml } from './files.js';

/** Folder grouping used by the commit-details file pane. */
export function filesToTreeHtml(files) {
	const root = {};
	files.forEach((f, i) => {
		const parts = (f.newFilePath || '').split('/');
		let node = root;
		for (let p = 0; p < parts.length; p++) {
			const part = parts[p];
			if (p === parts.length - 1) {
				(node.files ||= []).push({ file: f, index: i, name: part });
			} else {
				node.dirs ||= {};
				node.dirs[part] ||= {};
				node = node.dirs[part];
			}
		}
	});
	function walk(node, prefix) {
		let html = '';
		for (const [name, child] of Object.entries(node.dirs || {})) {
			html += `<div class="file-row dir">${escapeHtml(prefix + name)}/</div>`;
			html += walk(child, prefix + name + '/');
		}
		for (const item of node.files || []) {
			html += fileRowHtml(item.file, item.index, prefix + item.name);
		}
		return html;
	}
	return walk(root, '');
}
