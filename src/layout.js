/**
 * Lane-layout for a commit DAG. Ported from vscode-git-graph web/graph.ts
 * (Graph.loadCommits / determinePath) as a pure function — no DOM.
 */
import { GRAPH_COLOURS, GRAPH_GRID, UNCOMMITTED } from '../web/constants.js';

const NULL_VERTEX_ID = -1;

class Branch {
	constructor(colour) {
		this.colour = colour;
		this.end = 0;
		this.lines = [];
		this.numUncommitted = 0;
	}

	addLine(p1, p2, isCommitted, lockedFirst) {
		this.lines.push({ p1, p2, lockedFirst, isCommitted });
		if (isCommitted) {
			if (p2.x === 0 && p2.y < this.numUncommitted) this.numUncommitted = p2.y;
		} else {
			this.numUncommitted++;
		}
	}
}

class Vertex {
	constructor(id) {
		this.id = id;
		this.isStash = false;
		this.x = 0;
		this.children = [];
		this.parents = [];
		this.nextParent = 0;
		this.onBranch = null;
		this.isCommitted = true;
		this.isCurrent = false;
		this.nextX = 0;
		this.connections = [];
	}

	addChild(vertex) {
		this.children.push(vertex);
	}

	addParent(vertex) {
		this.parents.push(vertex);
	}

	getNextParent() {
		if (this.nextParent < this.parents.length) return this.parents[this.nextParent];
		return null;
	}

	registerParentProcessed() {
		this.nextParent++;
	}

	isMerge() {
		return this.parents.length > 1;
	}

	addToBranch(branch, x) {
		if (this.onBranch === null) {
			this.onBranch = branch;
			this.x = x;
		}
	}

	isNotOnBranch() {
		return this.onBranch === null;
	}

	getPoint() {
		return { x: this.x, y: this.id };
	}

	getNextPoint() {
		return { x: this.nextX, y: this.id };
	}

	getPointConnectingTo(vertex, onBranch) {
		for (let i = 0; i < this.connections.length; i++) {
			if (this.connections[i].connectsTo === vertex && this.connections[i].onBranch === onBranch) {
				return { x: i, y: this.id };
			}
		}
		return null;
	}

	registerUnavailablePoint(x, connectsToVertex, onBranch) {
		if (x === this.nextX) {
			this.nextX = x + 1;
			this.connections[x] = { connectsTo: connectsToVertex, onBranch };
		}
	}

	getColour() {
		return this.onBranch !== null ? this.onBranch.colour : 0;
	}
}

/**
 * @param {Array<{ hash: string, parents: string[] }>} commits newest-first
 * @param {{ head?: string | null }} [opts]
 */
export function layoutGraph(commits, opts = {}) {
	const head = opts.head ?? null;
	const vertices = [];
	const branches = [];
	const availableColours = [];

	if (commits.length === 0) {
		return {
			vertices: [],
			branches: [],
			laneCount: 0,
			graphWidth: GRAPH_GRID.offsetX * 2,
			grid: { ...GRAPH_GRID },
			colours: GRAPH_COLOURS.slice()
		};
	}

	const commitLookup = {};
	for (let i = 0; i < commits.length; i++) {
		commitLookup[commits[i].hash] = i;
		const vertex = new Vertex(i);
		if (commits[i].stash) vertex.isStash = true;
		vertices.push(vertex);
	}

	const nullVertex = new Vertex(NULL_VERTEX_ID);
	for (let i = 0; i < commits.length; i++) {
		const parents = commits[i].parents || [];
		for (let j = 0; j < parents.length; j++) {
			const parentHash = parents[j];
			if (typeof commitLookup[parentHash] === 'number') {
				vertices[i].addParent(vertices[commitLookup[parentHash]]);
				vertices[commitLookup[parentHash]].addChild(vertices[i]);
			} else {
				vertices[i].addParent(nullVertex);
			}
		}
	}

	if (commits[0].hash === UNCOMMITTED) {
		vertices[0].isCommitted = false;
	}

	if (head !== null && typeof commitLookup[head] === 'number') {
		vertices[commitLookup[head]].isCurrent = true;
	} else if (commits[0].hash === UNCOMMITTED) {
		vertices[0].isCurrent = true;
	}

	function getAvailableColour(startAt) {
		for (let i = 0; i < availableColours.length; i++) {
			if (startAt > availableColours[i]) return i;
		}
		availableColours.push(0);
		return availableColours.length - 1;
	}

	function determinePath(startAt) {
		let i = startAt;
		let vertex = vertices[i];
		let parentVertex = vertices[i].getNextParent();
		let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();

		if (
			parentVertex !== null &&
			parentVertex.id !== NULL_VERTEX_ID &&
			vertex.isMerge() &&
			!vertex.isNotOnBranch() &&
			!parentVertex.isNotOnBranch()
		) {
			let foundPointToParent = false;
			const parentBranch = parentVertex.onBranch;
			for (i = startAt + 1; i < vertices.length; i++) {
				const curVertex = vertices[i];
				let curPoint = curVertex.getPointConnectingTo(parentVertex, parentBranch);
				if (curPoint !== null) {
					foundPointToParent = true;
				} else {
					curPoint = curVertex.getNextPoint();
				}
				parentBranch.addLine(
					lastPoint,
					curPoint,
					vertex.isCommitted,
					!foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true
				);
				curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch);
				lastPoint = curPoint;
				if (foundPointToParent) {
					vertex.registerParentProcessed();
					break;
				}
			}
		} else {
			const branch = new Branch(getAvailableColour(startAt));
			vertex.addToBranch(branch, lastPoint.x);
			vertex.registerUnavailablePoint(lastPoint.x, vertex, branch);
			for (i = startAt + 1; i < vertices.length; i++) {
				const curVertex = vertices[i];
				const curPoint =
					parentVertex === curVertex && !parentVertex.isNotOnBranch()
						? curVertex.getPoint()
						: curVertex.getNextPoint();
				branch.addLine(lastPoint, curPoint, vertex.isCommitted, lastPoint.x < curPoint.x);
				curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branch);
				lastPoint = curPoint;

				if (parentVertex === curVertex) {
					vertex.registerParentProcessed();
					const parentVertexOnBranch = !parentVertex.isNotOnBranch();
					parentVertex.addToBranch(branch, curPoint.x);
					vertex = parentVertex;
					parentVertex = vertex.getNextParent();
					if (parentVertex === null || parentVertexOnBranch) {
						break;
					}
				}
			}
			if (i === vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) {
				vertex.registerParentProcessed();
			}
			branch.end = i;
			branches.push(branch);
			availableColours[branch.colour] = i;
		}
	}

	let i = 0;
	while (i < vertices.length) {
		if (vertices[i].getNextParent() !== null || vertices[i].isNotOnBranch()) {
			determinePath(i);
		} else {
			i++;
		}
	}

	let maxNextX = 0;
	for (const v of vertices) {
		if (v.nextX > maxNextX) maxNextX = v.nextX;
	}

	return {
		vertices: vertices.map((v) => ({
			id: v.id,
			x: v.x,
			colour: v.getColour(),
			isCommitted: v.isCommitted,
			isCurrent: v.isCurrent,
			isStash: Boolean(v.isStash)
		})),
		branches: branches.map((b) => ({
			colour: b.colour,
			lines: b.lines.map((line) => ({
				p1: { x: line.p1.x, y: line.p1.y },
				p2: { x: line.p2.x, y: line.p2.y },
				isCommitted: line.isCommitted,
				lockedFirst: line.lockedFirst
			}))
		})),
		laneCount: Math.max(1, maxNextX),
		graphWidth: 2 * GRAPH_GRID.offsetX + Math.max(0, maxNextX - 1) * GRAPH_GRID.x,
		grid: { ...GRAPH_GRID },
		colours: GRAPH_COLOURS.slice()
	};
}
