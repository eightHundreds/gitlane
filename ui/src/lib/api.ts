export function csrfToken(): string {
	return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
}

export async function api(path: string, options: RequestInit = {}) {
	const headers = new Headers(options.headers || {});
	if (options.method && options.method !== 'GET') {
		headers.set('X-Gitlane-Token', csrfToken());
	}
	const res = await fetch(path, { ...options, headers });
	let data: { error?: string } = {};
	try {
		data = await res.json();
	} catch {
		data = {};
	}
	if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
	return data as any;
}

export async function mutate(action: string, params: Record<string, unknown> = {}) {
	return api('/api/action', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, ...params })
	});
}
