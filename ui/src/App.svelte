<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { GRAPH_COLOURS, DEFAULT_MAX_COMMITS, LOAD_MORE_COMMITS, UNCOMMITTED } from '@gitlane/constants';
	import { escapeHtml } from '@gitlane/escape';
	import type { Commit } from '@gitlane/types';
	import { api } from './lib/api';
	import CdvPanel from './lib/CdvPanel.svelte';
	import { bindDiffOverlay, closeDiff, handleDiffEscape, isDiffDrawerOpen } from './lib/diff';
	import { abbrev, colourVar, formatDate } from './lib/format';
	import { renderGraph } from './lib/graph';
	import { openCommitMenu, openHeadMenu, openRemoteMenu, openStashMenu, openTagMenu } from './lib/menus';
	import { closeDialog, hideMenu, overlays } from './lib/overlays.svelte';
	import { refHtml } from './lib/refs';
	import { mutateAndReload, setLoadGraph } from './lib/reload';
	import { app, commitsQuery, readFileView } from './lib/state.svelte';
	import { initTheme, resolvedTheme, toggleTheme } from './lib/theme';

	let graphEl: SVGSVGElement | undefined = $state();
	let rowsEl: HTMLTableSectionElement | undefined = $state();
	let cdvHeight = $state(0);
	let loadError = $state('');

	const graphWidth = $derived(Math.max(app.layout?.graphWidth || 48, 88));
	const expandAt = $derived(
		app.selected.length && (app.details || app.compare)
			? app.commits.findIndex((c) => c.hash === app.selected[0])
			: -1
	);

	function applyGraphColours() {
		GRAPH_COLOURS.forEach((c, i) => {
			document.documentElement.style.setProperty(`--git-graph-color${i}`, c);
		});
	}

	function commitSearchBlob(commit: Commit) {
		return [
			commit.message,
			commit.author,
			commit.hash,
			...(commit.heads || []),
			...(commit.tags || []).map((t) => t.name),
			...(commit.remotes || []).map((r) => r.name),
			commit.stash?.selector || ''
		]
			.join(' ')
			.toLowerCase();
	}

	function applyFind() {
		const q = app.findQuery.trim().toLowerCase();
		app.findHits = [];
		if (q) {
			app.commits.forEach((c, i) => {
				if (commitSearchBlob(c).includes(q)) app.findHits.push(i);
			});
		}
		if (app.findIndex >= app.findHits.length) app.findIndex = app.findHits.length - 1;
		if (app.findIndex >= 0 && app.findHits[app.findIndex] != null) {
			document.querySelector(`tr.commit[data-id="${app.findHits[app.findIndex]}"]`)?.scrollIntoView({ block: 'center' });
		}
	}

	function findStep(delta: number) {
		if (!app.findHits.length) return;
		app.findIndex = (app.findIndex + delta + app.findHits.length) % app.findHits.length;
		applyFind();
	}

	async function loadGraph() {
		try {
			const data = await api(commitsQuery());
			overlays.error = '';
			loadError = '';
			app.commits = data.commits;
			app.layout = data.layout;
			app.head = data.head;
			app.branch = data.branch;
			app.repo = data.repo;
			app.detached = Boolean(data.detached);
			app.moreCommitsAvailable = Boolean(data.moreCommitsAvailable);
			app.maxCommits = data.maxCommits || app.maxCommits;
			app.branches = data.branches || [];
			app.remotes = data.remotes || [];
			document.title = `Gitlane — ${data.branch || 'repository'}`;
			applyFind();
			if (app.selected.length === 1) await showDetails(app.selected[0]);
			else if (app.selected.length === 2) await showCompare(app.selected[0], app.selected[1]);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			overlays.error = message;
			throw err;
		}
	}

	function orderHashes(a: string, b: string) {
		const ia = app.commits.findIndex((c) => c.hash === a);
		const ib = app.commits.findIndex((c) => c.hash === b);
		if (a === UNCOMMITTED) return { from: b, to: a };
		if (b === UNCOMMITTED) return { from: a, to: b };
		return ia <= ib ? { from: b, to: a } : { from: a, to: b };
	}

	async function showDetails(hash: string) {
		const details = await api(`/api/details?hash=${encodeURIComponent(hash)}`);
		app.details = details;
		app.compare = null;
	}

	async function showCompare(a: string, b: string) {
		const { from, to } = orderHashes(a, b);
		const cmp = await api(`/api/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
		app.compare = cmp;
		app.details = null;
	}

	async function onSelect(hash: string, ev: { metaKey?: boolean; ctrlKey?: boolean }) {
		hideMenu();
		const multi = Boolean(ev.metaKey || ev.ctrlKey);
		if (!multi && app.selected.length === 1 && app.selected[0] === hash) {
			app.selected = [];
			app.details = null;
			app.compare = null;
			return;
		}
		if (multi && app.selected.length === 1 && app.selected[0] !== hash) {
			app.selected = [app.selected[0], hash];
			try {
				await showCompare(app.selected[0], app.selected[1]);
			} catch (err: unknown) {
				overlays.error = err instanceof Error ? err.message : String(err);
			}
			return;
		}
		app.selected = [hash];
		try {
			await showDetails(hash);
		} catch (err: unknown) {
			overlays.error = err instanceof Error ? err.message : String(err);
		}
	}

	function closeCdv() {
		app.selected = [];
		app.details = null;
		app.compare = null;
	}

	function onTableClick(ev: MouseEvent) {
		const parent = (ev.target as HTMLElement).closest('#cdvSummary .cdvParent') as HTMLElement | null;
		if (parent?.dataset.hash) {
			ev.stopPropagation();
			onSelect(parent.dataset.hash, ev);
			return;
		}
		const tr = (ev.target as HTMLElement).closest('tr.commit') as HTMLElement | null;
		if (!tr?.dataset.hash) return;
		onSelect(tr.dataset.hash, ev);
	}

	function onTableContext(ev: MouseEvent) {
		const ref = (ev.target as HTMLElement).closest('.gitRef') as HTMLElement | null;
		if (ref) {
			ev.preventDefault();
			const type = ref.dataset.refType;
			const name = ref.dataset.name || '';
			if (type === 'head') openHeadMenu(ev, name);
			else if (type === 'remote') openRemoteMenu(ev, name);
			else if (type === 'tag') openTagMenu(ev, name, ref.dataset.annotated === '1');
			else if (type === 'stash') {
				const tr = (ev.target as HTMLElement).closest('tr.commit') as HTMLElement | null;
				const commit = tr ? app.commits[Number(tr.dataset.id)] : null;
				if (commit) openStashMenu(ev, commit);
			}
			return;
		}
		const tr = (ev.target as HTMLElement).closest('tr.commit') as HTMLElement | null;
		if (!tr) return;
		const commit = app.commits[Number(tr.dataset.id)];
		if (commit) openCommitMenu(ev, commit);
	}

	function drawGraph() {
		if (!graphEl || !app.layout) return;
		renderGraph(graphEl, app.layout, (id, ev) => {
			const commit = app.commits[id];
			if (commit) onSelect(commit.hash, ev);
		}, { at: expandAt, y: expandAt >= 0 ? cdvHeight || 280 : 0 });
	}

	$effect(() => {
		app.layout;
		app.commits;
		expandAt;
		cdvHeight;
		tick().then(drawGraph);
	});

	async function onDialogOk() {
		const dlg = overlays.dialog;
		if (!dlg) return;
		try {
			await dlg.onOk();
		} catch (err: unknown) {
			overlays.error = err instanceof Error ? err.message : String(err);
		}
		closeDialog();
	}

	onMount(() => {
		applyGraphColours();
		initTheme();
		app.theme = resolvedTheme();
		app.fileView = readFileView();
		setLoadGraph(loadGraph);
		bindDiffOverlay();
		loadGraph().catch((err: unknown) => {
			loadError = err instanceof Error ? err.message : String(err);
		});
		const onDocClick = (ev: MouseEvent) => {
			const menu = document.getElementById('contextMenu');
			if (menu && !menu.contains(ev.target as Node)) hideMenu();
		};
		const onKey = (ev: KeyboardEvent) => {
			const meta = ev.metaKey || ev.ctrlKey;
			if (meta && ev.key.toLowerCase() === 'f') {
				ev.preventDefault();
				app.findOpen = true;
				tick().then(() => (document.getElementById('findInput') as HTMLInputElement | null)?.focus());
				return;
			}
			if (meta && ev.key.toLowerCase() === 'r') {
				ev.preventDefault();
				loadGraph().catch(() => {});
				return;
			}
			if (meta && ev.key.toLowerCase() === 'h') {
				ev.preventDefault();
				const i = app.commits.findIndex((c) => c.hash === app.head);
				if (i >= 0) document.querySelector(`tr.commit[data-id="${i}"]`)?.scrollIntoView({ block: 'center' });
				return;
			}
			if (ev.key === 'Enter' && overlays.dialog) {
				ev.preventDefault();
				onDialogOk();
				return;
			}
			if (ev.key === 'ArrowDown' && app.selected.length === 1 && !overlays.dialog && !isDiffDrawerOpen()) {
				const i = app.commits.findIndex((c) => c.hash === app.selected[0]);
				if (i >= 0 && i + 1 < app.commits.length) onSelect(app.commits[i + 1].hash, {});
				return;
			}
			if (ev.key === 'ArrowUp' && app.selected.length === 1 && !overlays.dialog && !isDiffDrawerOpen()) {
				const i = app.commits.findIndex((c) => c.hash === app.selected[0]);
				if (i > 0) onSelect(app.commits[i - 1].hash, {});
				return;
			}
			if (ev.key === 'Escape') {
				if (handleDiffEscape(ev)) return;
				if (overlays.dialog) closeDialog();
				else if (app.findOpen) {
					app.findOpen = false;
					app.findHits = [];
					app.findIndex = -1;
				} else if (expandAt >= 0) closeCdv();
				else hideMenu();
			}
		};
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<div id="app">
	<header id="toolbar">
		<div class="brand">Gitlane</div>
		<div id="repoLabel" class="repo-label">{app.repo}</div>
		<div id="branchLabel" class="branch-label">{app.detached ? 'HEAD detached' : app.branch || ''}</div>
		<label class="toolbar-field">Branches
			<select
				id="branchFilter"
				bind:value={app.branchFilter}
				onchange={() => {
					app.maxCommits = DEFAULT_MAX_COMMITS;
					loadGraph().catch(() => {});
				}}
			>
				<option value="">Show All</option>
				{#each app.branches as b}
					<option value={b}>{b}</option>
				{/each}
			</select>
		</label>
		<label class="toolbar-check">
			<input type="checkbox" id="showRemotes" bind:checked={app.showRemotes} onchange={() => loadGraph().catch(() => {})}>
			Remotes
		</label>
		<label class="toolbar-check">
			<input type="checkbox" id="showStashes" bind:checked={app.showStashes} onchange={() => loadGraph().catch(() => {})}>
			Stashes
		</label>
		<button type="button" id="fetchBtn" title="Fetch from remotes" hidden={app.remotes.length === 0} onclick={() => mutateAndReload('fetch', { prune: true }).catch((err) => (overlays.error = err.message))}>Fetch</button>
		<button type="button" id="findBtn" title="Find (Ctrl/Cmd+F)" onclick={() => (app.findOpen = true)}>Find</button>
		<button type="button" id="refreshBtn" title="Refresh (Ctrl/Cmd+R)" onclick={() => loadGraph().catch(() => {})}>Refresh</button>
		<button
			type="button"
			id="themeBtn"
			title="Switch to {app.theme === 'light' ? 'dark' : 'light'} theme"
			aria-pressed={app.theme === 'dark' ? 'true' : 'false'}
			onclick={() => (app.theme = toggleTheme())}
		>{app.theme === 'light' ? 'Dark' : 'Light'}</button>
	</header>
	<div id="findBar" hidden={!app.findOpen}>
		<input
			id="findInput"
			type="search"
			placeholder="Find in message, author, hash, branch, tag…"
			bind:value={app.findQuery}
			oninput={() => {
				app.findIndex = 0;
				applyFind();
			}}
		>
		<span id="findCount">{app.findQuery.trim() ? (app.findHits.length ? `${app.findIndex + 1}/${app.findHits.length}` : '0/0') : ''}</span>
		<button type="button" id="findPrev" onclick={() => findStep(-1)}>Prev</button>
		<button type="button" id="findNext" onclick={() => findStep(1)}>Next</button>
		<button
			type="button"
			id="findClose"
			onclick={() => {
				app.findOpen = false;
				app.findHits = [];
				app.findIndex = -1;
			}}
		>Close</button>
	</div>
	<div id="errorBanner" hidden={!overlays.error} role="alert" aria-live="polite">{overlays.error}</div>
	<div id="tableHead">
		<table>
			<colgroup>
				<col id="graphCol" class="graph-col" style="width:{graphWidth}px">
				<col>
				<col class="date-col">
				<col class="author-col">
				<col class="hash-col">
			</colgroup>
			<thead>
				<tr>
					<th>Graph</th>
					<th>Description</th>
					<th>Date</th>
					<th>Author</th>
					<th>Commit</th>
				</tr>
			</thead>
		</table>
	</div>
	<div id="view">
		<svg id="commitGraph" xmlns="http://www.w3.org/2000/svg" bind:this={graphEl}></svg>
		<div id="commitTable" role="presentation" onclick={onTableClick} oncontextmenu={onTableContext}>
			<table>
				<colgroup>
					<col class="graph-col" style="width:{graphWidth}px">
					<col>
					<col class="date-col">
					<col class="author-col">
					<col class="hash-col">
				</colgroup>
				<tbody id="commitRows" bind:this={rowsEl}>
					{#if loadError}
						<tr><td colspan="5" class="empty">{loadError}</td></tr>
					{:else}
						{#each app.commits as commit, i (commit.hash)}
							{@const v = app.layout?.vertices[i]}
							{@const colourIndex = v ? v.colour : 0}
							{@const selected = app.selected.includes(commit.hash)}
							{@const isCompare = app.selected.length === 2 && selected}
							{@const current = commit.hash === app.head || commit.hash === UNCOMMITTED}
							{@const findHit = app.findHits.includes(i)}
							{@const findCurrent = findHit && app.findIndex >= 0 && app.findHits[app.findIndex] === i}
							<tr
								class="commit"
								class:current
								class:selected
								class:compare={isCompare && commit.hash === app.selected[1]}
								class:stash={Boolean(commit.stash)}
								class:find-hit={findHit}
								class:find-current={findCurrent}
								data-id={i}
								data-hash={commit.hash}
								data-color={colourIndex}
							>
								<td class="graph-cell"></td>
								<td>
									<span class="description">
										{#if commit.hash === app.head}
											<span class="commitHeadDot" style="--git-graph-color:{colourVar(colourIndex)}"></span>
										{/if}
										{@html refHtml(commit, colourIndex)}
										<span class="text">{commit.message}</span>
									</span>
								</td>
								<td class="date-col">{formatDate(commit.date)}</td>
								<td class="author-col">{commit.author || ''}</td>
								<td class="hash-col" title={commit.hash}>{commit.hash === UNCOMMITTED ? '*' : abbrev(commit.hash)}</td>
							</tr>
							{#if expandAt === i}
								<tr id="cdvRow">
									<td class="graph-cell"></td>
									<td colspan="4">
										<div bind:clientHeight={cdvHeight}>
											<CdvPanel details={app.details} compare={app.compare} onClose={closeCdv} />
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					{/if}
				</tbody>
			</table>
			<div id="loadMore" hidden={!app.moreCommitsAvailable}>
				<button
					type="button"
					id="loadMoreBtn"
					onclick={() => {
						app.maxCommits += LOAD_MORE_COMMITS;
						loadGraph().catch(() => {});
					}}
				>Load More Commits</button>
			</div>
		</div>
	</div>
</div>

<div id="contextMenu" hidden={!overlays.menu} style={overlays.menu ? `left:${overlays.menu.x}px;top:${overlays.menu.y}px` : ''}>
	{#if overlays.menu}
		{#each overlays.menu.items as item, i}
			{#if item.separator}
				<div class="menu-sep"></div>
			{:else}
				<button type="button" data-i={i} onclick={() => { hideMenu(); item.run?.(); }}>{item.label}</button>
			{/if}
		{/each}
	{/if}
</div>

<div id="dialog" hidden={!overlays.dialog}>
	<div class="dialog-card">
		<h3 id="dialogTitle">{overlays.dialog?.title || ''}</h3>
		<div id="dialogBody">{@html overlays.dialog?.bodyHtml || ''}</div>
		<div class="dialog-actions">
			<button type="button" id="dialogCancel" onclick={closeDialog}>Cancel</button>
			<button type="button" class="primary" id="dialogOk" onclick={onDialogOk}>OK</button>
		</div>
	</div>
</div>

<div id="diffOverlay" role="dialog" aria-modal="true" aria-labelledby="diffTitle">
	<div id="diffBackdrop"></div>
	<div id="diffDrawer">
		<div id="diffBar">
			<div id="diffTitle"></div>
			<button type="button" id="diffFull" title="Full screen" aria-pressed="false">Full screen</button>
			<button type="button" id="diffClose">Close</button>
		</div>
		<div id="monacoHost" class="monaco-host"></div>
	</div>
</div>
