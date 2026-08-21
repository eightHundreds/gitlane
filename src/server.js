import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, createReadStream, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	UNCOMMITTED,
	getCommitComparison,
	getCommitDetails,
	getCommits,
	getFileAtRevision,
	getFileDiffSides,
	getRepoInfo,
	getTagDetails
} from './git.js';
import { runAction } from './actions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const require = createRequire(import.meta.url);

export function monacoMinDir() {
	let pkgDir;
	try {
		pkgDir = path.dirname(require.resolve('monaco-editor/package.json'));
	} catch {
		throw new Error('monaco-editor is not installed. Reinstall Gitlane: npm install -g gitlane');
	}
	const min = path.join(pkgDir, 'min');
	if (!existsSync(path.join(min, 'vs', 'loader.js'))) {
		throw new Error('monaco-editor is incomplete. Reinstall Gitlane: npm install -g gitlane');
	}
	return min;
}

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.map': 'application/json'
};

function send(res, status, body, headers = {}) {
	const payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
	res.writeHead(status, {
		'Content-Length': payload.length,
		...headers
	});
	res.end(payload);
}

function sendJson(res, status, obj) {
	send(res, status, JSON.stringify(obj), {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store'
	});
}

export const MAX_WRITE_BODY = 64 * 1024;

export function allowedWriteOrigins(host, port) {
	const origins = new Set();
	if (!host || port == null) return origins;
	origins.add(formatListenUrl(host, port).replace(/\/$/, ''));
	if (host === '0.0.0.0' || host === '::' || host === '127.0.0.1' || host === 'localhost' || host === '::1') {
		origins.add(`http://127.0.0.1:${port}`);
		origins.add(`http://localhost:${port}`);
		origins.add(`http://[::1]:${port}`);
	}
	return origins;
}

/**
 * Block CSRF / DNS-rebinding writes: JSON body, session token, and
 * Origin (when present) must match the actual listen address.
 */
export function mutationAllowed(req, ctx = {}) {
	const type = String(req.headers['content-type'] || '')
		.split(';')[0]
		.trim()
		.toLowerCase();
	if (type !== 'application/json') {
		return { ok: false, error: 'Write requests must use Content-Type: application/json' };
	}
	const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
	if (site === 'cross-site') {
		return { ok: false, error: 'Cross-origin write rejected' };
	}
	const token = req.headers['x-gitlane-token'];
	if (!ctx.csrfToken || token !== ctx.csrfToken) {
		return { ok: false, error: 'Invalid CSRF token' };
	}
	const origin = req.headers.origin;
	if (origin) {
		try {
			new URL(origin);
		} catch {
			return { ok: false, error: 'Invalid Origin' };
		}
		const allowed = allowedWriteOrigins(ctx.host, ctx.port);
		if (!allowed.has(origin)) {
			return { ok: false, error: 'Cross-origin write rejected' };
		}
	}
	return { ok: true };
}

function readBody(req, maxBytes = MAX_WRITE_BODY) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let n = 0;
		let overflow = false;
		req.on('data', (c) => {
			n += c.length;
			if (overflow) return;
			if (n > maxBytes) {
				overflow = true;
				chunks.length = 0;
				const err = new Error('Request body too large');
				err.statusCode = 413;
				reject(err);
				return;
			}
			chunks.push(c);
		});
		req.on('end', () => {
			if (overflow) return;
			const raw = Buffer.concat(chunks).toString('utf8');
			if (!raw) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(raw));
			} catch {
				reject(new Error('Invalid JSON body'));
			}
		});
		req.on('error', reject);
	});
}

function safeJoin(root, rel) {
	const resolved = path.resolve(root, rel);
	const prefix = root.endsWith(path.sep) ? root : root + path.sep;
	if (resolved !== root && !resolved.startsWith(prefix)) return null;
	return resolved;
}

async function serveFile(res, filePath) {
	try {
		const st = statSync(filePath);
		if (!st.isFile()) {
			send(res, 404, 'Not found');
			return;
		}
		const ext = path.extname(filePath).toLowerCase();
		res.writeHead(200, {
			'Content-Type': MIME[ext] || 'application/octet-stream',
			'Content-Length': st.size,
			'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-store' : 'public, max-age=3600'
		});
		createReadStream(filePath).pipe(res);
	} catch {
		send(res, 404, 'Not found');
	}
}

async function handleGet(repo, url) {
	const route = url.pathname;
	const q = url.searchParams;
	if (route === '/api/health') {
		return { ok: true, vscode: false, ...(await getRepoInfo(repo)) };
	}
	if (route === '/api/commits') {
		const max = Number(q.get('max') || 0);
		const branchesParam = q.get('branches');
		return getCommits(repo, {
			maxCommits: max > 0 ? max : undefined,
			branches: branchesParam ? branchesParam.split(',').filter(Boolean) : null,
			showRemoteBranches: q.get('remotes') !== '0',
			showStashes: q.get('stashes') !== '0',
			showTags: q.get('tags') !== '0'
		});
	}
	if (route === '/api/tag') {
		return getTagDetails(repo, q.get('name') || '');
	}
	if (route === '/api/details') {
		return getCommitDetails(repo, q.get('hash') || '');
	}
	if (route === '/api/compare') {
		return getCommitComparison(repo, q.get('from') || '', q.get('to') || '');
	}
	if (route === '/api/file') {
		const rev = q.get('rev') ?? '';
		const filePath = q.get('path') || '';
		const content = await getFileAtRevision(repo, rev, filePath);
		return { rev: rev || UNCOMMITTED, path: filePath, content };
	}
	if (route === '/api/diff') {
		return getFileDiffSides(repo, {
			fromHash: q.get('from') || '',
			toHash: q.get('to') || '',
			path: q.get('path') || '',
			oldFilePath: q.get('oldPath') || undefined,
			newFilePath: q.get('newPath') || undefined,
			status: q.get('status') || 'M'
		});
	}
	return null;
}

async function handleApi(repo, url, req, res, ctx) {
	const route = url.pathname;
	try {
		if (req.method === 'GET') {
			const data = await handleGet(repo, url);
			if (data) {
				sendJson(res, 200, data);
				return;
			}
		}
		if (req.method === 'POST' && route === '/api/action') {
			const gate = mutationAllowed(req, ctx);
			if (!gate.ok) {
				sendJson(res, 403, { error: gate.error });
				return;
			}
			const body = await readBody(req);
			if (!body.action) {
				sendJson(res, 400, { error: 'action is required' });
				return;
			}
			const info = await runAction(repo, body.action, body);
			sendJson(res, 200, info);
			return;
		}
		sendJson(res, 404, { error: `Unknown API route: ${req.method} ${route}` });
	} catch (err) {
		sendJson(res, err.statusCode || 400, { error: err.message || String(err) });
	}
}

export function createGitGraphServer(options) {
	const repo = options.repo;
	const ctx = options.ctx || {
		csrfToken: randomBytes(32).toString('hex'),
		host: options.host || '127.0.0.1',
		port: options.port ?? 3840
	};
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

		if (url.pathname.startsWith('/api/')) {
			await handleApi(repo, url, req, res, ctx);
			return;
		}

		if (url.pathname.startsWith('/vendor/monaco/')) {
			const rel = url.pathname.slice('/vendor/monaco/'.length);
			const filePath = safeJoin(monacoMinDir(), rel);
			if (!filePath || !existsSync(filePath)) {
				send(res, 404, 'Not found');
				return;
			}
			await serveFile(res, filePath);
			return;
		}

		if (url.pathname === '/' || url.pathname === '/index.html') {
			const html = readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8').replaceAll(
				'%%CSRF_TOKEN%%',
				ctx.csrfToken
			);
			send(res, 200, html, {
				'Content-Type': MIME['.html'],
				'Cache-Control': 'no-store'
			});
			return;
		}

		const rel = url.pathname.replace(/^\/+/, '');
		const filePath = safeJoin(WEB_DIR, rel);
		if (filePath && existsSync(filePath)) {
			await serveFile(res, filePath);
			return;
		}

		send(res, 404, 'Not found');
	});
	return { server, ctx };
}

export function formatListenUrl(host, port) {
	const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	return `http://${hostname}:${port}/`;
}

export function listenGitGraph(options) {
	const host = options.host || '127.0.0.1';
	const port = options.port ?? 3840;
	const repo = options.repo;
	const { server, ctx } = createGitGraphServer({ repo, host, port });
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			const addr = server.address();
			const actualPort = typeof addr === 'object' && addr ? addr.port : port;
			ctx.host = host;
			ctx.port = actualPort;
			const url = formatListenUrl(host, actualPort);
			resolve({ server, url, host, port: actualPort, repo, csrfToken: ctx.csrfToken });
		});
	});
}


