export function csrfToken() {
	return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
}

export async function api(path, options = {}) {
	const headers = { ...(options.headers || {}) };
	if (options.method && options.method !== 'GET') {
		headers['X-Gitlane-Token'] = csrfToken();
	}
	const res = await fetch(path, { ...options, headers });
	let data = {};
	try {
		data = await res.json();
	} catch {
		data = {};
	}
	if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
	return data;
}

export async function mutate(action, params = {}) {
	return api('/api/action', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, ...params })
	});
}
