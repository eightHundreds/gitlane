export type FileChange = {
	oldFilePath: string;
	newFilePath: string;
	type: string;
	additions: number | null;
	deletions: number | null;
};

export type StashMeta = {
	selector: string;
	baseHash: string | null;
};

export type Commit = {
	hash: string;
	parents: string[];
	author: string;
	email: string;
	date: number;
	message: string;
	heads: string[];
	tags: { name: string; annotated: boolean }[];
	remotes: { name: string; remote: string | null }[];
	stash: StashMeta | null;
};

export type StashRecord = {
	hash: string;
	selector: string;
	baseHash: string | null;
	date: number;
	author: string;
	email: string;
	message: string;
};

export type GraphPoint = { x: number; y: number };

export type GraphLine = {
	p1: GraphPoint;
	p2: GraphPoint;
	isCommitted: boolean;
	lockedFirst: boolean;
};

export type GraphLayout = {
	vertices: {
		id: number;
		x: number;
		colour: number;
		isCommitted: boolean;
		isCurrent: boolean;
		isStash: boolean;
	}[];
	branches: { colour: number; lines: GraphLine[] }[];
	laneCount: number;
	graphWidth: number;
	grid: { x: number; y: number; offsetX: number; offsetY: number };
	colours: string[];
};

export type CommitDetails = {
	hash: string;
	parents: string[];
	author: string;
	email: string;
	date: number;
	committer: string;
	committerEmail: string;
	committerDate: number;
	body: string;
	fileChanges: FileChange[];
	fromHash: string | null;
	toHash: string;
};

export type ActionParams = Record<string, unknown>;
