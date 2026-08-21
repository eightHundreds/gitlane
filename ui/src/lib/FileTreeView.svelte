<script lang="ts">
	import type { FileTreeNode } from '@gitlane/filetree';
	import FileRow from './FileRow.svelte';
	import FileTreeView from './FileTreeView.svelte';

	let {
		nodes,
		fromHash,
		toHash
	}: {
		nodes: FileTreeNode[];
		fromHash: string | null;
		toHash: string | null;
	} = $props();

	let collapsed = $state(new Set<string>());

	function keyFor(node: FileTreeNode, i: number) {
		return node.kind === 'dir' ? `d:${node.depth}:${node.name}:${i}` : `f:${node.index}`;
	}

	function toggle(key: string) {
		const next = new Set(collapsed);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		collapsed = next;
	}
</script>

{#each nodes as node, i (keyFor(node, i))}
	{#if node.kind === 'dir'}
		{@const key = keyFor(node, i)}
		{@const open = !collapsed.has(key)}
		<div
			class="file-row dir"
			class:collapsed={!open}
			role="button"
			tabindex="0"
			style="--tree-depth:{node.depth}"
			onclick={() => toggle(key)}
			onkeydown={(ev) => {
				if (ev.key === 'Enter' || ev.key === ' ') {
					ev.preventDefault();
					toggle(key);
				}
			}}
		>
			<span class="file-type tree-twist" aria-hidden="true">{open ? '▾' : '▸'}</span>
			<span class="tree-name">{node.name}</span>
		</div>
		<div class="tree-children" hidden={!open}>
			<FileTreeView nodes={node.children} {fromHash} {toHash} />
		</div>
	{:else}
		<FileRow
			file={node.file}
			index={node.index}
			label={node.label}
			depth={node.depth}
			{fromHash}
			{toHash}
		/>
	{/if}
{/each}
