import { mutate } from './api';
import { clearError } from './overlays.svelte';

let _loadGraph: () => Promise<void> = async () => {};

export function setLoadGraph(fn: () => Promise<void>) {
	_loadGraph = fn;
}

export function loadGraph() {
	return _loadGraph();
}

export async function mutateAndReload(action: string, params: Record<string, unknown> = {}) {
	clearError();
	await mutate(action, params);
	await loadGraph();
}
