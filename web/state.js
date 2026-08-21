import { DEFAULT_MAX_COMMITS } from './constants.js';

export const state = {
	commits: [],
	layout: null,
	head: null,
	branch: null,
	repo: '',
	selected: [],
	details: null,
	compare: null,
	diffEditor: null,
	models: [],
	maxCommits: DEFAULT_MAX_COMMITS,
	moreCommitsAvailable: false,
	branches: [],
	remotes: [],
	showRemotes: true,
	showStashes: true,
	branchFilter: '',
	findHits: [],
	findIndex: -1,
	fileView: 'list',
	fileChanges: [],
	fromHash: null,
	toHash: null
};
