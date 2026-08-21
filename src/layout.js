/**
 * Assign columns (lanes) and polyline segments for a newest-first commit DAG.
 */
import { GRAPH_COLOURS, GRAPH_GRID, UNCOMMITTED } from '../web/constants.js';

function emptyLayout() {
	return {
		vertices: [],
		branches: [],
		laneCount: 0,
		graphWidth: GRAPH_GRID.offsetX * 2,
		grid: { ...GRAPH_GRID },
		colours: GRAPH_COLOURS.slice()
	};
}

/**
 * @param {Array<{ hash: string, parents: string[], stash?: unknown }>} commits newest-first
 * @param {{ head?: string | null }} [opts]
 */
export function layoutGraph(commits, opts = {}) {
	if (commits.length === 0) return emptyLayout();

	const head = opts.head ?? null;
	const n = commits.length;
	const lookup = Object.fromEntries(commits.map((c, i) => [c.hash, i]));
	const reserved = [];
	const laneColour = [];
	let nextColour = 0;
	const xOf = new Array(n);
	const colourOf = new Array(n);

	function newLane(hash) {
		const x = reserved.length;
		reserved.push(hash ?? null);
		laneColour.push(nextColour++);
		return x;
	}

	function freeLane() {
		return reserved.findIndex((h) => h == null);
	}

	function placeCommit(hash) {
		let x = reserved.indexOf(hash);
		if (x < 0) {
			x = freeLane();
			if (x < 0) x = newLane(hash);
			else laneColour[x] = nextColour++;
		}
		for (let j = 0; j < reserved.length; j++) {
			if (j !== x && reserved[j] === hash) reserved[j] = null;
		}
		return x;
	}

	function reserve(hash) {
		const existing = reserved.indexOf(hash);
		if (existing >= 0) return existing;
		let x = freeLane();
		if (x < 0) return newLane(hash);
		reserved[x] = hash;
		laneColour[x] = nextColour++;
		return x;
	}

	for (let i = 0; i < n; i++) {
		const x = placeCommit(commits[i].hash);
		xOf[i] = x;
		colourOf[i] = laneColour[x];
		const parents = (commits[i].parents || []).filter((p) => typeof lookup[p] === 'number');
		reserved[x] = parents[0] ?? null;
		for (let p = 1; p < parents.length; p++) reserve(parents[p]);
	}

	const linesByColour = new Map();
	function addLine(colour, p1, p2, isCommitted) {
		let lines = linesByColour.get(colour);
		if (!lines) {
			lines = [];
			linesByColour.set(colour, lines);
		}
		lines.push({
			p1,
			p2,
			isCommitted,
			lockedFirst: p1.x < p2.x
		});
	}

	for (let i = 0; i < n; i++) {
		const isCommitted = commits[i].hash !== UNCOMMITTED;
		const parents = (commits[i].parents || []).filter((p) => typeof lookup[p] === 'number');
		for (const parentHash of parents) {
			const pi = lookup[parentHash];
			const x1 = xOf[i];
			const y1 = i;
			const x2 = xOf[pi];
			const y2 = pi;
			const colour = colourOf[i];
			if (x1 === x2) {
				addLine(colour, { x: x1, y: y1 }, { x: x2, y: y2 }, isCommitted);
				continue;
			}
			const midY = y1 + 1;
			addLine(colour, { x: x1, y: y1 }, { x: x2, y: midY }, isCommitted);
			if (midY !== y2) {
				addLine(colour, { x: x2, y: midY }, { x: x2, y: y2 }, isCommitted);
			}
		}
	}

	let maxX = 0;
	for (const x of xOf) if (x > maxX) maxX = x;
	const laneCount = Math.max(1, maxX + 1);

	const vertices = commits.map((c, i) => ({
		id: i,
		x: xOf[i],
		colour: colourOf[i],
		isCommitted: c.hash !== UNCOMMITTED,
		isCurrent:
			(head !== null && c.hash === head) ||
			(head === null && i === 0 && c.hash === UNCOMMITTED),
		isStash: Boolean(c.stash)
	}));

	const branches = [];
	for (const [colour, lines] of linesByColour) {
		branches.push({ colour, lines });
	}

	return {
		vertices,
		branches,
		laneCount,
		graphWidth: 2 * GRAPH_GRID.offsetX + Math.max(0, laneCount - 1) * GRAPH_GRID.x,
		grid: { ...GRAPH_GRID },
		colours: GRAPH_COLOURS.slice()
	};
}
