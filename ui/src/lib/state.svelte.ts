import { DEFAULT_MAX_COMMITS } from '@gitlane/constants';
import type { Commit, CommitDetails, FileChange, GraphLayout } from '@gitlane/types';

export type FileView = 'list' | 'tree';

const FILE_VIEW_KEY = 'gitlane-file-view';

export function readFileView(): FileView {
	try {
		const stored = localStorage.getItem(FILE_VIEW_KEY);
		if (stored === 'list' || stored === 'tree') return stored;
	} catch {
		/* private mode */
	}
	return 'list';
}

export function setFileView(view: FileView) {
	app.fileView = view;
	try {
		localStorage.setItem(FILE_VIEW_KEY, view);
	} catch {
		/* private mode */
	}
}

export const app = $state({
	commits: [] as Commit[],
	layout: null as GraphLayout | null,
	head: null as string | null,
	branch: null as string | null,
	repo: '',
	detached: false,
	selected: [] as string[],
	details: null as CommitDetails | null,
	compare: null as { fromHash: string; toHash: string; fileChanges: FileChange[] } | null,
	maxCommits: DEFAULT_MAX_COMMITS,
	moreCommitsAvailable: false,
	branches: [] as string[],
	remotes: [] as string[],
	showRemotes: true,
	showStashes: true,
	branchFilter: '',
	findOpen: false,
	findQuery: '',
	findHits: [] as number[],
	findIndex: -1,
	fileView: readFileView() as FileView,
	theme: 'dark' as 'light' | 'dark'
});

export function commitsQuery() {
	const params = new URLSearchParams();
	params.set('max', String(app.maxCommits));
	params.set('remotes', app.showRemotes ? '1' : '0');
	params.set('stashes', app.showStashes ? '1' : '0');
	if (app.branchFilter) params.set('branches', app.branchFilter);
	return `/api/commits?${params.toString()}`;
}
