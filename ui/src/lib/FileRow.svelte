<script lang="ts">
	import type { FileChange } from '@gitlane/types';
	import { openDiff } from './diff';
	import { openFileMenu } from './menus';

	let {
		file,
		index,
		label,
		depth = null,
		fromHash,
		toHash
	}: {
		file: FileChange;
		index: number;
		label: string;
		depth?: number | null;
		fromHash: string | null;
		toHash: string | null;
	} = $props();

	const style = $derived(depth == null ? undefined : `--tree-depth:${depth}`);
	const stat = $derived(
		file.additions == null && file.deletions == null
			? ''
			: `+${file.additions ?? 0} −${file.deletions ?? 0}`
	);
</script>

<div
	class="file-row gitDiffPossible"
	role="button"
	tabindex="0"
	data-i={index}
	title={file.newFilePath || undefined}
	style={style}
	onclick={() => openDiff(file, fromHash, toHash)}
	onkeydown={(ev) => {
		if (ev.key === 'Enter' || ev.key === ' ') {
			ev.preventDefault();
			openDiff(file, fromHash, toHash);
		}
	}}
	oncontextmenu={(ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		openFileMenu(ev, file, fromHash, toHash);
	}}
>
	<span class="file-type {file.type}">{file.type}</span>
	<span class="tree-name">{label}</span>
	{#if stat}<span class="file-stat">{stat}</span>{/if}
</div>
