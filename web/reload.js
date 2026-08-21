import { mutate } from './api.js';
import { clearError } from './dom.js';

let _loadGraph = async () => {};

export function setLoadGraph(fn) {
	_loadGraph = fn;
}

export function loadGraph() {
	return _loadGraph();
}

export async function mutateAndReload(action, params = {}) {
	clearError();
	await mutate(action, params);
	await loadGraph();
}
