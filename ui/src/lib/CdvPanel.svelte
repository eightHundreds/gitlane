<script lang="ts">
	import { UNCOMMITTED } from '@gitlane/constants';
	import { fileLabel } from '@gitlane/files';
	import { buildFileChangeTree } from '@gitlane/filetree';
	import type { CommitDetails, FileChange } from '@gitlane/types';
	import { formatDate, formatPerson, linkify } from './format';
	import FileRow from './FileRow.svelte';
	import FileTreeView from './FileTreeView.svelte';
	import { app, setFileView } from './state.svelte';

	let { details, compare, onClose }: {
		details: CommitDetails | null;
		compare: { fromHash: string; toHash: string; fileChanges: FileChange[] } | null;
		onClose: () => void;
	} = $props();

	const files = $derived(compare?.fileChanges || details?.fileChanges || []);
	const fromHash = $derived(compare?.fromHash ?? details?.fromHash ?? '');
	const toHash = $derived(compare?.toHash ?? details?.toHash ?? '');
	const tree = $derived(buildFileChangeTree(files));

	function parentKnown(hash: string) {
		return app.commits.some((c) => c.hash === hash);
	}
</script>

<section id="cdv">
	<div id="cdvSummary">
		<div id="cdvControls">
			<button type="button" id="cdvClose" onclick={onClose}>Close</button>
			<button type="button" id="cdvViewList" class:active={app.fileView === 'list'} onclick={() => setFileView('list')}>List</button>
			<button type="button" id="cdvViewTree" class:active={app.fileView === 'tree'} onclick={() => setFileView('tree')}>Tree</button>
		</div>
		{#if compare}
			<h3>Compare</h3>
			<div class="cdvKeys">
				<div><b>From: </b><span class="cdvHash">{compare.fromHash}</span></div>
				<div><b>To: </b><span class="cdvHash">{compare.toHash === UNCOMMITTED ? 'Working Tree' : compare.toHash}</span></div>
			</div>
		{:else if details && details.hash === UNCOMMITTED}
			<h3>Uncommitted Changes</h3>
			<div class="meta">{details.body || 'Working tree vs HEAD'}</div>
		{:else if details}
			<h3>Commit Details</h3>
			<div class="cdvKeys">
				<div><b>Commit: </b><span class="cdvHash">{details.hash}</span></div>
				<div>
					<b>Parents: </b>
					{#if !details.parents?.length}
						None
					{:else}
						{#each details.parents as p, i}
							{#if i > 0}, {/if}
							{#if parentKnown(p)}
								<span class="cdvParent" data-hash={p}>{p}</span>
							{:else}
								<span>{p}</span>
							{/if}
						{/each}
					{/if}
				</div>
				<div><b>Author: </b>{@html formatPerson(details.author, details.email)}</div>
				{#if Number(details.committerDate) > 0 && Number(details.committerDate) !== Number(details.date)}
					<div><b>Author Date: </b>{formatDate(details.date)}</div>
					<div><b>Committer: </b>{@html formatPerson(details.committer, details.committerEmail)}</div>
					<div><b>Committer Date: </b>{formatDate(details.committerDate)}</div>
				{:else if (details.committer && details.committer !== details.author) || (details.committerEmail && details.committerEmail !== details.email)}
					<div><b>Date: </b>{formatDate(details.date)}</div>
					<div><b>Committer: </b>{@html formatPerson(details.committer, details.committerEmail)}</div>
				{:else}
					<div><b>Date: </b>{formatDate(details.date)}</div>
				{/if}
			</div>
			<pre>{@html linkify(details.body || '')}</pre>
		{/if}
	</div>
	<div id="cdvFiles">
		{#if !files.length}
			<div class="empty">No file changes</div>
		{:else if app.fileView === 'tree'}
			<div class="file-tree">
				<FileTreeView nodes={tree} {fromHash} {toHash} />
			</div>
		{:else}
			{#each files as f, i (f.newFilePath + i)}
				<FileRow file={f} index={i} label={fileLabel(f)} {fromHash} {toHash} />
			{/each}
		{/if}
	</div>
</section>
