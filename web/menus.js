import { UNCOMMITTED } from './constants.js';
import { api } from './api.js';
import { promptDialog, showMenu } from './dialog.js';
import { fieldChecked, fieldValue, showError } from './dom.js';
import { escapeHtml } from './escape.js';
import { openDiff, openFileAtRevision } from './diff.js';
import { abbrev, copyText, formatDate } from './format.js';
import { mutateAndReload } from './reload.js';
import { state } from './state.js';

function runOrError(fn) {
	return async () => {
		try {
			await fn();
		} catch (err) {
			showError(err.message);
		}
	};
}

function remoteSelect(id, emptyLabel) {
	const opts = state.remotes.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
	if (emptyLabel != null) {
		return `<select id="${id}"><option value="">${escapeHtml(emptyLabel)}</option>${opts}</select>`;
	}
	return `<select id="${id}">${opts}</select>`;
}

function mergeDialog(ref, label = ref) {
	promptDialog({
		title: 'Merge',
		bodyHtml: `<p>Merge ${escapeHtml(label)} into the current branch?</p>
			<label><input id="mgNoff" type="checkbox"> Create a merge commit even if fast-forward</label>
			<label><input id="mgSquash" type="checkbox"> Squash</label>`,
		onOk: async () =>
			mutateAndReload('merge', {
				ref,
				noFastForward: fieldChecked('mgNoff'),
				squash: fieldChecked('mgSquash')
			})
	});
}

function rebaseDialog(ref, label = ref) {
	promptDialog({
		title: 'Rebase',
		bodyHtml: `<p>Rebase the current branch onto ${escapeHtml(label)}?</p>`,
		onOk: async () => mutateAndReload('rebase', { ref })
	});
}

function resetDialog(hash) {
	promptDialog({
		title: 'Reset',
		bodyHtml: `<p>Reset current branch to ${escapeHtml(abbrev(hash))}</p>
			<label><input type="radio" name="rsMode" value="soft"> Soft</label>
			<label><input type="radio" name="rsMode" value="mixed" checked> Mixed</label>
			<label><input type="radio" name="rsMode" value="hard"> Hard</label>`,
		onOk: async () => {
			const mode = document.querySelector('input[name="rsMode"]:checked')?.value || 'mixed';
			await mutateAndReload('reset', { hash, mode });
		}
	});
}

function createBranchDialog(commitHash) {
	promptDialog({
		title: 'Create branch',
		bodyHtml: `<label>Name</label><input id="branchName" type="text" autofocus>
			<label><input id="branchCheckout" type="checkbox"> Checkout after create</label>`,
		onOk: async () => {
			const name = fieldValue('branchName').trim();
			if (!name) return;
			await mutateAndReload('createBranch', {
				name,
				commitHash,
				checkout: fieldChecked('branchCheckout')
			});
		}
	});
	queueMicrotask(() => document.getElementById('branchName')?.focus());
}

export function checkoutTargetFor(commit) {
	if (commit.hash === UNCOMMITTED) return null;
	if (commit.heads && commit.heads.length) {
		if (state.branch && commit.heads.includes(state.branch)) return state.branch;
		return commit.heads[0];
	}
	return commit.hash;
}

export function openCommitMenu(ev, commit) {
	ev.preventDefault();
	if (commit.hash === UNCOMMITTED) {
		openUncommittedMenu(ev);
		return;
	}
	if (commit.stash) {
		openStashMenu(ev, commit);
		return;
	}
	const target = checkoutTargetFor(commit);
	const checkoutLabel =
		commit.heads && commit.heads.includes(target)
			? `Checkout branch "${target}"`
			: `Checkout commit ${abbrev(target)}`;
	const isMerge = (commit.parents || []).length > 1;
	showMenu(ev.clientX, ev.clientY, [
		{
			label: 'Add tag…',
			run: () => {
				promptDialog({
					title: 'Add tag',
					bodyHtml: `<label>Name</label><input id="tagName" type="text" autofocus>
						<label>Message (annotated)</label><input id="tagMessage" type="text">
						<label><input id="tagAnnotated" type="checkbox" checked> Annotated tag</label>`,
					onOk: async () => {
						const name = fieldValue('tagName').trim();
						if (!name) return;
						await mutateAndReload('addTag', {
							name,
							hash: commit.hash,
							message: fieldValue('tagMessage'),
							annotated: fieldChecked('tagAnnotated')
						});
					}
				});
				queueMicrotask(() => document.getElementById('tagName')?.focus());
			}
		},
		{ label: 'Create branch…', run: () => createBranchDialog(commit.hash) },
		{ separator: true },
		{
			label: checkoutLabel,
			run: runOrError(() => mutateAndReload('checkout', { target }))
		},
		{
			label: 'Cherry pick…',
			run: () => {
				promptDialog({
					title: 'Cherry pick',
					bodyHtml: `${isMerge ? `<label>Parent index</label><input id="cpParent" type="number" min="1" value="1">` : ''}
						<label><input id="cpOrigin" type="checkbox"> Record origin</label>
						<label><input id="cpNoCommit" type="checkbox"> No commit</label>`,
					onOk: async () => {
						await mutateAndReload('cherryPick', {
							hash: commit.hash,
							recordOrigin: fieldChecked('cpOrigin'),
							noCommit: fieldChecked('cpNoCommit'),
							parentIndex: isMerge ? Number(fieldValue('cpParent') || 1) : 0
						});
					}
				});
			}
		},
		{
			label: 'Revert…',
			run: () => {
				promptDialog({
					title: 'Revert commit',
					bodyHtml: isMerge
						? `<label>Parent index</label><input id="rvParent" type="number" min="1" value="1"><p>Revert merge ${abbrev(commit.hash)}?</p>`
						: `<p>Revert ${abbrev(commit.hash)}?</p>`,
					onOk: async () => {
						await mutateAndReload('revert', {
							hash: commit.hash,
							parentIndex: isMerge ? Number(fieldValue('rvParent') || 1) : 0
						});
					}
				});
			}
		},
		{
			label: 'Drop commit…',
			run: () => {
				promptDialog({
					title: 'Drop commit',
					bodyHtml: `<p>Permanently drop ${abbrev(commit.hash)} from the current branch?</p>`,
					onOk: async () => mutateAndReload('dropCommit', { hash: commit.hash })
				});
			}
		},
		{ separator: true },
		{
			label: 'Merge into current branch…',
			run: () => mergeDialog(commit.hash, abbrev(commit.hash))
		},
		{
			label: 'Rebase current branch on this commit…',
			run: () => rebaseDialog(commit.hash, abbrev(commit.hash))
		},
		{
			label: 'Reset current branch to this commit…',
			run: () => resetDialog(commit.hash)
		},
		{ separator: true },
		{ label: 'Copy commit hash', run: () => copyText(commit.hash, 'hash') },
		{ label: 'Copy commit subject', run: () => copyText(commit.message, 'subject') }
	]);
}

export function openUncommittedMenu(ev) {
	showMenu(ev.clientX, ev.clientY, [
		{
			label: 'Stash uncommitted changes…',
			run: () => {
				promptDialog({
					title: 'Stash',
					bodyHtml: `<label>Message</label><input id="stMsg" type="text">
						<label><input id="stUntracked" type="checkbox" checked> Include untracked</label>`,
					onOk: async () =>
						mutateAndReload('stash', {
							message: fieldValue('stMsg').trim(),
							includeUntracked: fieldChecked('stUntracked')
						})
				});
			}
		},
		{
			label: 'Reset uncommitted changes…',
			run: () => {
				promptDialog({
					title: 'Reset uncommitted',
					bodyHtml: `<label><input type="radio" name="rsu" value="mixed" checked> Mixed</label>
						<label><input type="radio" name="rsu" value="hard"> Hard</label>`,
					onOk: async () =>
						mutateAndReload('resetUncommitted', {
							mode: document.querySelector('input[name="rsu"]:checked')?.value || 'mixed'
						})
				});
			}
		},
		{
			label: 'Clean untracked files…',
			run: () => {
				promptDialog({
					title: 'Clean',
					bodyHtml: `<p>Delete untracked files?</p><label><input id="clDirs" type="checkbox" checked> Include directories</label>`,
					onOk: async () => mutateAndReload('clean', { directories: fieldChecked('clDirs') })
				});
			}
		}
	]);
}

export function openStashMenu(ev, commit) {
	const selector = commit.stash.selector;
	showMenu(ev.clientX, ev.clientY, [
		{
			label: 'Apply stash…',
			run: () => {
				promptDialog({
					title: 'Apply stash',
					bodyHtml: `<label><input id="stIdx" type="checkbox"> Reinstate index</label>`,
					onOk: async () =>
						mutateAndReload('stashApply', {
							selector,
							reinstateIndex: fieldChecked('stIdx')
						})
				});
			}
		},
		{
			label: 'Pop stash…',
			run: () => {
				promptDialog({
					title: 'Pop stash',
					bodyHtml: `<p>Pop ${escapeHtml(selector)}?</p>`,
					onOk: async () => mutateAndReload('stashPop', { selector })
				});
			}
		},
		{
			label: 'Drop stash…',
			run: () => {
				promptDialog({
					title: 'Drop stash',
					bodyHtml: `<p>Drop ${escapeHtml(selector)}?</p>`,
					onOk: async () => mutateAndReload('stashDrop', { selector })
				});
			}
		},
		{
			label: 'Create branch from stash…',
			run: () => {
				promptDialog({
					title: 'Branch from stash',
					bodyHtml: `<label>Name</label><input id="stBranch" type="text" autofocus>`,
					onOk: async () => {
						const name = fieldValue('stBranch').trim();
						if (!name) return;
						await mutateAndReload('stashBranch', { name, selector });
					}
				});
			}
		},
		{ separator: true },
		{ label: 'Copy stash name', run: () => copyText(selector, 'stash') }
	]);
}

export function openHeadMenu(ev, name) {
	showMenu(ev.clientX, ev.clientY, [
		{ label: `Checkout branch "${name}"`, run: runOrError(() => mutateAndReload('checkout', { target: name })) },
		{
			label: 'Rename branch…',
			run: () => {
				promptDialog({
					title: 'Rename branch',
					bodyHtml: `<label>New name</label><input id="rnName" type="text" value="${escapeHtml(name)}">`,
					onOk: async () => {
						const newName = fieldValue('rnName').trim();
						if (!newName) return;
						await mutateAndReload('renameBranch', { oldName: name, newName });
					}
				});
			}
		},
		{
			label: 'Delete branch…',
			run: () => {
				promptDialog({
					title: 'Delete branch',
					bodyHtml: `<p>Delete ${escapeHtml(name)}?</p><label><input id="delForce" type="checkbox"> Force delete</label>`,
					onOk: async () =>
						mutateAndReload('deleteBranch', { name, force: fieldChecked('delForce') })
				});
			}
		},
		{ label: 'Merge into current branch…', run: () => mergeDialog(name) },
		{ label: 'Rebase current branch on this branch…', run: () => rebaseDialog(name) },
		...(state.remotes.length
			? [
					{
						label: 'Push branch…',
						run: () => {
							promptDialog({
								title: 'Push branch',
								bodyHtml: `<label>Remote</label>${remoteSelect('pushRemote')}
									<label><input id="pushUp" type="checkbox" checked> Set upstream</label>
									<label><input id="pushForce" type="checkbox"> Force</label>`,
								onOk: async () =>
									mutateAndReload('pushBranch', {
										name,
										remote: fieldValue('pushRemote'),
										setUpstream: fieldChecked('pushUp'),
										force: fieldChecked('pushForce')
									})
							});
						}
					}
				]
			: []),
		{ separator: true },
		{ label: 'Copy branch name', run: () => copyText(name, 'branch') }
	]);
}

export function openRemoteMenu(ev, fullName) {
	const slash = fullName.indexOf('/');
	const remote = slash >= 0 ? fullName.slice(0, slash) : state.remotes[0] || 'origin';
	const branch = slash >= 0 ? fullName.slice(slash + 1) : fullName;
	showMenu(ev.clientX, ev.clientY, [
		{
			label: `Checkout "${fullName}"…`,
			run: runOrError(() => mutateAndReload('checkout', { target: fullName }))
		},
		{
			label: 'Delete remote branch…',
			run: () => {
				promptDialog({
					title: 'Delete remote branch',
					bodyHtml: `<p>Delete ${escapeHtml(fullName)}?</p>`,
					onOk: async () => mutateAndReload('deleteRemoteBranch', { remote, name: branch })
				});
			}
		},
		{
			label: 'Fetch into local branch…',
			run: () => {
				promptDialog({
					title: 'Fetch into local',
					bodyHtml: `<label>Local branch</label><input id="filLocal" type="text" value="${escapeHtml(branch)}">
						<label><input id="filForce" type="checkbox"> Force</label>`,
					onOk: async () =>
						mutateAndReload('fetchIntoLocal', {
							remote,
							remoteBranch: branch,
							localBranch: fieldValue('filLocal').trim() || branch,
							force: fieldChecked('filForce')
						})
				});
			}
		},
		{ label: 'Merge into current branch…', run: () => mergeDialog(fullName) },
		{
			label: 'Pull into current branch…',
			run: () => {
				promptDialog({
					title: 'Pull',
					bodyHtml: `<p>Pull ${escapeHtml(fullName)}?</p>
						<label><input id="plNoff" type="checkbox"> No fast-forward</label>
						<label><input id="plSquash" type="checkbox"> Squash</label>`,
					onOk: async () =>
						mutateAndReload('pull', {
							remote,
							branch,
							noFastForward: fieldChecked('plNoff'),
							squash: fieldChecked('plSquash')
						})
				});
			}
		},
		{ separator: true },
		{ label: 'Copy branch name', run: () => copyText(fullName, 'branch') }
	]);
}

export function openTagMenu(ev, name, annotated) {
	showMenu(ev.clientX, ev.clientY, [
		...(annotated
			? [
					{
						label: 'View details',
						run: async () => {
							try {
								const details = await api(`/api/tag?name=${encodeURIComponent(name)}`);
								promptDialog({
									title: `Tag ${name}`,
									bodyHtml: `<pre>${escapeHtml(
										`Object: ${details.tagHash}\nCommit: ${details.commitHash}\nTagger: ${details.tagger} <${details.email}>\nDate: ${formatDate(details.date)}\n\n${details.message}`
									)}</pre>`,
									onOk: async () => {}
								});
							} catch (err) {
								showError(err.message);
							}
						}
					}
				]
			: []),
		{
			label: 'Delete tag…',
			run: () => {
				promptDialog({
					title: 'Delete tag',
					bodyHtml: `<p>Delete tag ${escapeHtml(name)}?</p>
						${state.remotes.length ? `<label>Also delete on remote</label>${remoteSelect('delTagRemote', '(local only)')}` : ''}`,
					onOk: async () =>
						mutateAndReload('deleteTag', {
							name,
							remote: fieldValue('delTagRemote') || ''
						})
				});
			}
		},
		...(state.remotes.length
			? [
					{
						label: 'Push tag…',
						run: () => {
							promptDialog({
								title: 'Push tag',
								bodyHtml: `<label>Remote</label>${remoteSelect('pushTagRemote')}`,
								onOk: async () =>
									mutateAndReload('pushTag', {
										name,
										remote: fieldValue('pushTagRemote')
									})
							});
						}
					}
				]
			: []),
		{ separator: true },
		{ label: 'Copy tag name', run: () => copyText(name, 'tag') }
	]);
}

export function openFileMenu(ev, file, fromHash, toHash) {
	showMenu(ev.clientX, ev.clientY, [
		{ label: 'View diff', run: () => openDiff(file, fromHash, toHash) },
		{
			label: 'View file at this revision',
			run: () => openFileAtRevision(file, toHash)
		},
		{ label: 'Copy file path', run: () => copyText(file.newFilePath, 'path') }
	]);
}
