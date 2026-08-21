import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyRepo, createFixtureRepo, gitRaw, postAction } from './helpers.js';
import { existsSync } from 'node:fs';
import { formatListenUrl, listenGitGraph, monacoMinDir, mutationAllowed, MAX_WRITE_BODY } from '../src/server.js';
import { UNCOMMITTED } from '../web/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('HTTP server (shipped entry adapter)', () => {
	let fx;
	let listening;

	before(async () => {
		fx = await createFixtureRepo();
		listening = await listenGitGraph({ repo: fx.repo, host: '127.0.0.1', port: 0 });
	});

	after(async () => {
		if (listening?.server) {
			await new Promise((resolve) => listening.server.close(resolve));
		}
		if (fx?.repo) await fs.rm(fx.repo, { recursive: true, force: true });
	});

	it('resolves monaco-editor from the Node module search path', () => {
		const dir = monacoMinDir();
		assert.ok(existsSync(path.join(dir, 'vs', 'loader.js')));
	});

	it('package manifest has no vscode dependency', async () => {
		const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
		const all = {
			...pkg.dependencies,
			...pkg.devDependencies,
			...pkg.peerDependencies,
			...pkg.optionalDependencies
		};
		assert.equal(all.vscode, undefined);
		assert.ok(!Object.keys(all).some((k) => k === 'vscode' || k.startsWith('@types/vscode')));
		assert.ok(pkg.dependencies['monaco-editor']);
	});

	it('shipped source never imports vscode', async () => {
		async function walk(dir) {
			const out = [];
			for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
				const p = path.join(dir, ent.name);
				if (ent.isDirectory()) out.push(...(await walk(p)));
				else if (/\.(js|html|css|json)$/.test(ent.name)) out.push(p);
			}
			return out;
		}
		const files = [...(await walk(path.join(ROOT, 'src'))), ...(await walk(path.join(ROOT, 'web')))];
		for (const file of files) {
			const text = await fs.readFile(file, 'utf8');
			assert.doesNotMatch(text, /from ['"]vscode['"]|require\(['"]vscode['"]\)/);
		}
	});

	it('serves the UI with graph surface and Monaco, and fixture commit/file APIs', async () => {
		const ui = await fetch(listening.url);
		assert.equal(ui.status, 200);
		const html = await ui.text();
		assert.match(html, /commitGraph/);
		assert.match(html, /monaco/i);
		assert.match(html, /Gitlane/);

		const appJs = await fetch(new URL('/app.js', listening.url));
		assert.equal(appJs.status, 200);
		const appText = await appJs.text();
		assert.doesNotMatch(appText, /\bvscode\b/);
		const diffJs = await (await fetch(new URL('/diff.js', listening.url))).text();
		assert.match(diffJs, /monaco/i);
		const tableJs = await (await fetch(new URL('/table.js', listening.url))).text();
		assert.match(tableJs, /renderGraph/);

		const loader = await fetch(new URL('/vendor/monaco/vs/loader.js', listening.url));
		assert.equal(loader.status, 200);

		const commitsRes = await fetch(new URL('/api/commits', listening.url));
		assert.equal(commitsRes.status, 200);
		const data = await commitsRes.json();
		const hashes = data.commits.map((c) => c.hash);
		assert.ok(hashes.includes(fx.hashes.merge));
		assert.ok(hashes.includes(fx.hashes.feature));
		assert.ok(data.commits.some((c) => c.message === fx.subjects.merge));
		assert.ok(data.commits.some((c) => c.hash === UNCOMMITTED));
		assert.ok(data.layout.laneCount > 1);

		const fileRes = await fetch(
			new URL(`/api/file?rev=${encodeURIComponent(fx.hashes.feature)}&path=feature.txt`, listening.url)
		);
		assert.equal(fileRes.status, 200);
		const fileJson = await fileRes.json();
		assert.equal(fileJson.content, fx.files.featureFile);

		const health = await fetch(new URL('/api/health', listening.url));
		const healthJson = await health.json();
		assert.equal(healthJson.ok, true);
		assert.equal(healthJson.vscode, false);
	});

	it('rejects cross-origin and non-JSON write requests; JSON same-origin mutates the repo', async () => {
		const host = `127.0.0.1:${listening.port}`;
		const ctx = { csrfToken: listening.csrfToken, host: '127.0.0.1', port: listening.port };
		const token = listening.csrfToken;
		assert.equal(mutationAllowed({ headers: { 'content-type': 'text/plain', host } }, ctx).ok, false);
		assert.equal(
			mutationAllowed({
				headers: {
					'content-type': 'application/json',
					origin: 'https://evil.example',
					'x-gitlane-token': token,
					host
				}
			}, ctx).ok,
			false
		);
		assert.equal(
			mutationAllowed({
				headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', host }
			}, ctx).ok,
			false
		);
		assert.equal(
			mutationAllowed({ headers: { 'content-type': 'application/json', host } }, ctx).ok,
			false
		);
		assert.equal(
			mutationAllowed({
				headers: {
					'content-type': 'application/json',
					'x-gitlane-token': token,
					host
				}
			}, ctx).ok,
			true
		);
		assert.equal(
			mutationAllowed({
				headers: {
					'content-type': 'application/json',
					'x-gitlane-token': token,
					origin: `http://${host}`,
					host
				}
			}, ctx).ok,
			true
		);

		const csrf = await fetch(new URL('/api/action', listening.url), {
			method: 'POST',
			headers: {
				'Content-Type': 'text/plain',
				Origin: 'https://evil.example'
			},
			body: JSON.stringify({ action: 'checkout', target: 'feature' })
		});
		assert.equal(csrf.status, 403);
		assert.equal((await gitRaw(fx.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'main');

		const cross = await fetch(new URL('/api/action', listening.url), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'https://evil.example',
				'X-Gitlane-Token': token
			},
			body: JSON.stringify({ action: 'checkout', target: 'feature' })
		});
		assert.equal(cross.status, 403);
		assert.equal((await gitRaw(fx.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'main');

		const noToken = await fetch(new URL('/api/action', listening.url), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'checkout', target: 'feature' })
		});
		assert.equal(noToken.status, 403);

		const tooBig = await fetch(new URL('/api/action', listening.url), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Gitlane-Token': token },
			body: 'x'.repeat(MAX_WRITE_BODY + 8)
		});
		assert.equal(tooBig.status, 413);

		const page = await fetch(listening.url);
		const html = await page.text();
		assert.ok(html.includes(token));
		assert.ok(!html.includes('%%CSRF_TOKEN%%'));

		const ok = await postAction(listening, { action: 'checkout', target: 'feature' });
		assert.equal(ok.status, 200);
		assert.equal((await gitRaw(fx.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'feature');

		const reload = await fetch(new URL('/api/commits', listening.url));
		const data = await reload.json();
		assert.equal(data.branch, 'feature');
		assert.equal(data.head, fx.hashes.feature);

		const back = await postAction(listening, { action: 'checkout', target: 'main' });
		assert.equal(back.status, 200);
	});

	it('serves an empty graph for a git repo with no commits', async () => {
		const empty = await createEmptyRepo();
		const emptyServer = await listenGitGraph({ repo: empty, host: '127.0.0.1', port: 0 });
		try {
			const res = await fetch(new URL('/api/commits', emptyServer.url));
			assert.equal(res.status, 200);
			const data = await res.json();
			assert.equal(data.commits.length, 0);
			assert.equal(data.head, null);
			assert.equal(data.branch, 'main');
		} finally {
			await new Promise((resolve) => emptyServer.server.close(resolve));
			await fs.rm(empty, { recursive: true, force: true });
		}
	});

	it('details API returns full hash, parents, and a non-empty file list', async () => {
		const res = await fetch(
			new URL(`/api/details?hash=${encodeURIComponent(fx.hashes.feature)}`, listening.url)
		);
		assert.equal(res.status, 200);
		const details = await res.json();
		assert.equal(details.hash, fx.hashes.feature);
		const oracleParents = (await gitRaw(fx.repo, ['log', '-1', '--format=%P', fx.hashes.feature]))
			.trim()
			.split(' ')
			.filter(Boolean);
		assert.deepEqual(details.parents, oracleParents);
		assert.ok(Array.isArray(details.fileChanges) && details.fileChanges.length > 0);
		assert.ok(
			details.fileChanges.some((f) => f.newFilePath === 'feature.txt' || f.newFilePath === 'README.md')
		);
	});

	it('rejected checkout and duplicate branch return an error message body', async () => {
		const bad = await postAction(listening, { action: 'checkout', target: '-f' });
		assert.equal(bad.status, 400);
		const badJson = await bad.json();
		assert.match(String(badJson.error || ''), /invalid checkout target/i);

		const dup = await postAction(listening, {
			action: 'createBranch',
			name: 'main',
			commitHash: fx.hashes.merge
		});
		assert.ok(dup.status >= 400);
		const dupJson = await dup.json();
		assert.ok(dupJson.error);
		assert.match(String(dupJson.error), /already exists|fatal/i);
		assert.equal((await gitRaw(fx.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'main');

		const legacy = await fetch(new URL('/api/checkout', listening.url), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Gitlane-Token': listening.csrfToken },
			body: JSON.stringify({ action: 'checkout', target: 'feature' })
		});
		assert.equal(legacy.status, 404);
		assert.match((await legacy.json()).error, /Unknown API route/);
	});

	it('diff API returns an error body for an invalid revision', async () => {
		const res = await fetch(
			new URL(
				`/api/diff?from=not-a-real-revision-zzzz&to=${encodeURIComponent(fx.hashes.feature)}&path=README.md&status=M`,
				listening.url
			)
		);
		assert.ok(res.status >= 400);
		const body = await res.json();
		assert.ok(body.error);
		assert.match(String(body.error), /invalid object name|bad revision|unknown revision|ambiguous argument/i);
	});

	it('served UI includes Gitlane chrome and ships UI modules', async () => {
		const html = await (await fetch(listening.url)).text();
		assert.match(html, /id="errorBanner"/);
		assert.match(html, /commitGraph/);
		assert.match(html, /id="findBar"/);
		assert.match(html, /id="fetchBtn"/);
		assert.match(html, /id="themeBtn"/);
		assert.match(html, /id="branchFilter"/);
		assert.match(html, /id="showRemotes"/);
		assert.match(html, /id="showStashes"/);
		assert.match(html, /Load More Commits/);
		const css = await (await fetch(new URL('/styles.css', listening.url))).text();
		assert.match(css, /data-theme="light"/);
		const modules = [
			'/app.js',
			'/menus.js',
			'/table.js',
			'/cdv.js',
			'/diff.js',
			'/find.js',
			'/api.js',
			'/filetree.js',
			'/constants.js',
			'/theme.js'
		];
		for (const pathName of modules) {
			const res = await fetch(new URL(pathName, listening.url));
			assert.equal(res.status, 200, `missing ${pathName}`);
		}
		const treeJs = await fetch(new URL('/filetree.js', listening.url));
		assert.match(await treeJs.text(), /export function filesToTreeHtml/);
		const table = await (await fetch(new URL('/table.js', listening.url))).text();
		assert.match(table, /gitRefHeadRemote/);
		assert.match(table, /data-ref-type="remote"/);
		const menus = await (await fetch(new URL('/menus.js', listening.url))).text();
		for (const label of [
			'Add tag',
			'Create branch',
			'Cherry pick',
			'Merge into current branch',
			'Reset current branch to this commit',
			'Delete remote branch',
			'Stash uncommitted changes',
			'View file at this revision'
		]) {
			assert.ok(menus.includes(label), `menus.js missing ${label}`);
		}
	});

	it('formats IPv6 listen URLs with brackets', () => {
		assert.equal(formatListenUrl('::1', 3840), 'http://[::1]:3840/');
		assert.equal(formatListenUrl('127.0.0.1', 3840), 'http://127.0.0.1:3840/');
	});
});
