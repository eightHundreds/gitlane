import { escapeHtml } from './escape.js';
import { fileRowHtml } from './files.js';
import type { FileChange } from './types.js';

function compareName(a: string, b: string) {
	return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

export type FileTreeFile = {
	kind: 'file';
	name: string;
	label: string;
	depth: number;
	index: number;
	file: FileChange;
};

export type FileTreeDir = {
	kind: 'dir';
	name: string;
	depth: number;
	children: FileTreeNode[];
};

export type FileTreeNode = FileTreeDir | FileTreeFile;

type BuildNode = {
	dirs: Record<string, BuildNode>;
	files: { file: FileChange; index: number; name: string }[];
};

function emptyBuild(): BuildNode {
	return { dirs: {}, files: [] };
}

function treeFileLabel(item: { file: FileChange; name: string }) {
	const f = item.file;
	if (f.type === 'R') {
		const oldName = (f.oldFilePath || '').split('/').pop();
		if (oldName && oldName !== item.name) return `${oldName} → ${item.name}`;
	}
	return item.name;
}

function flatten(node: BuildNode, depth: number): FileTreeNode[] {
	const out: FileTreeNode[] = [];
	const dirNames = Object.keys(node.dirs).sort(compareName);
	for (const name of dirNames) {
		out.push({
			kind: 'dir',
			name,
			depth,
			children: flatten(node.dirs[name], depth + 1)
		});
	}
	const items = node.files.slice().sort((a, b) => compareName(a.name, b.name));
	for (const item of items) {
		out.push({
			kind: 'file',
			name: item.name,
			label: treeFileLabel(item),
			depth,
			index: item.index,
			file: item.file
		});
	}
	return out;
}

/** Folder grouping for commit-details file changes. HTML is an adapter over this. */
export function buildFileChangeTree(files: FileChange[]): FileTreeNode[] {
	const root = emptyBuild();
	files.forEach((f, i) => {
		const parts = (f.newFilePath || '').split('/').filter(Boolean);
		if (!parts.length) return;
		let node = root;
		for (let p = 0; p < parts.length; p++) {
			const part = parts[p];
			if (p === parts.length - 1) {
				node.files.push({ file: f, index: i, name: part });
			} else {
				node.dirs[part] ||= emptyBuild();
				node = node.dirs[part];
			}
		}
	});
	return flatten(root, 0);
}

function renderNodes(nodes: FileTreeNode[]): string {
	let html = '';
	for (const node of nodes) {
		if (node.kind === 'dir') {
			html += `<div class="file-row dir" style="--tree-depth:${node.depth}">
				<span class="file-type tree-twist" aria-hidden="true">▾</span>
				<span class="tree-name">${escapeHtml(node.name)}</span>
			</div>`;
			html += `<div class="tree-children">${renderNodes(node.children)}</div>`;
		} else {
			html += fileRowHtml(node.file, node.index, node.label, { tree: true, depth: node.depth });
		}
	}
	return html;
}

export function filesToTreeHtml(files: FileChange[]) {
	return `<div class="file-tree">${renderNodes(buildFileChangeTree(files))}</div>`;
}

export function bindTreeCollapse(root: ParentNode) {
	root.querySelectorAll('.file-row.dir').forEach((row) => {
		row.addEventListener('click', () => {
			const kids = row.nextElementSibling as HTMLElement | null;
			if (!kids?.classList.contains('tree-children')) return;
			const open = kids.hidden;
			kids.hidden = !open;
			row.classList.toggle('collapsed', !open);
			const twist = row.querySelector('.tree-twist');
			if (twist) twist.textContent = open ? '▾' : '▸';
		});
	});
}
