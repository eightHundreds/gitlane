import { els } from './dom.js';
import { state } from './state.js';

function commitSearchBlob(commit) {
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

export function applyFind() {
	const q = (els.findInput?.value || '').trim().toLowerCase();
	state.findHits = [];
	if (q) {
		state.commits.forEach((c, i) => {
			if (commitSearchBlob(c).includes(q)) state.findHits.push(i);
		});
	}
	if (state.findIndex >= state.findHits.length) state.findIndex = state.findHits.length - 1;
	if (els.findCount) {
		els.findCount.textContent = q
			? state.findHits.length
				? `${state.findIndex + 1}/${state.findHits.length}`
				: '0/0'
			: '';
	}
	document.querySelectorAll('tr.commit.find-hit').forEach((el) => el.classList.remove('find-hit', 'find-current'));
	state.findHits.forEach((i, n) => {
		const tr = els.rows.querySelector(`tr.commit[data-id="${i}"]`);
		if (!tr) return;
		tr.classList.add('find-hit');
		if (n === state.findIndex) {
			tr.classList.add('find-current');
			tr.scrollIntoView({ block: 'center' });
		}
	});
}

export function findStep(delta) {
	if (!state.findHits.length) return;
	state.findIndex = (state.findIndex + delta + state.findHits.length) % state.findHits.length;
	applyFind();
}

export function openFind() {
	if (!els.findBar) return;
	els.findBar.hidden = false;
	els.findInput?.focus();
	els.findInput?.select();
	applyFind();
}

export function closeFind() {
	if (!els.findBar) return;
	els.findBar.hidden = true;
	state.findHits = [];
	state.findIndex = -1;
	applyFind();
}
