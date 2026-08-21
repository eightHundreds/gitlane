import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createFixtureRepo } from './helpers.js';
import { listenGitGraph } from '../src/server.js';

async function graphPage(browser, colorScheme = 'dark') {
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
	await page.emulateMedia({ colorScheme });
	return page;
}

describe('browser graph + Monaco (playwright if available)', () => {
	let fx;
	let listening;
	let chromium;

	before(async () => {
		try {
			({ chromium } = await import('playwright'));
		} catch {
			chromium = null;
			return;
		}
		fx = await createFixtureRepo();
		listening = await listenGitGraph({ repo: fx.repo, host: '127.0.0.1', port: 0 });
	});

	after(async () => {
		if (listening?.server) await new Promise((resolve) => listening.server.close(resolve));
		if (fx?.repo) await fs.rm(fx.repo, { recursive: true, force: true });
	});

	it('renders filled graph, fixture subjects, and Monaco both-side contents', async (t) => {
		if (!chromium) {
			t.skip('playwright is not installed');
			return;
		}
		let browser;
		try {
			browser = await chromium.launch({ headless: true });
		} catch (err) {
			t.skip(`chromium unavailable: ${err.message}`);
			return;
		}
		const page = await graphPage(browser);
		const errors = [];
		page.on('pageerror', (err) => errors.push(String(err)));
		try {
			await page.goto(listening.url, { waitUntil: 'networkidle' });
			await page.waitForSelector('tr.commit', { timeout: 10000 });
			const info = await page.evaluate(() => {
				const svg = document.getElementById('commitGraph');
				return {
					circles: svg ? svg.querySelectorAll('circle').length : 0,
					paths: svg ? svg.querySelectorAll('path').length : 0,
					height: svg ? Number(svg.getAttribute('height') || 0) : 0,
					subjects: [...document.querySelectorAll('tr.commit .text')].map((el) => el.textContent)
				};
			});
			assert.ok(info.circles >= 4, `expected many vertices, got ${info.circles}`);
			assert.ok(info.paths >= 2, `expected parent lanes, got ${info.paths}`);
			assert.ok(info.height > 80);
			assert.ok(info.subjects.includes('merge feature into main'));
			assert.ok(info.subjects.includes('add feature work'));

			await page.locator('tr.commit', { hasText: 'add feature work' }).click();
			await page.waitForSelector('#cdvFiles .file-row', { timeout: 8000 });
			const inline = await page.evaluate(() => {
				const row = [...document.querySelectorAll('tr.commit')].find(
					(r) => r.querySelector('.text')?.textContent === 'add feature work'
				);
				const next = row?.nextElementSibling;
				const appKids = [...document.getElementById('app').children].map((el) => el.id);
				return {
					cdvIsNextRow: next?.id === 'cdvRow',
					cdvInsideTable: Boolean(document.querySelector('#commitTable #cdvRow')),
					appHasDockedCdv: appKids.includes('cdv')
				};
			});
			assert.ok(inline.cdvIsNextRow && inline.cdvInsideTable, `details must sit under the clicked commit: ${JSON.stringify(inline)}`);
			assert.equal(inline.appHasDockedCdv, false);
			const featureHash = await page.locator('tr.commit', { hasText: 'add feature work' }).getAttribute('data-hash');
			assert.equal(featureHash, fx.hashes.feature);
			const summary = await page.locator('#cdvSummary').innerText();
			assert.ok(summary.includes(featureHash), `inline details must show the full hash, got: ${summary}`);
			assert.match(summary, /Parents:/);
			assert.match(summary, /Author:/);
			assert.match(summary, /Fixture User/);
			await page.screenshot({
				path: '/var/folders/0h/hrn9lk3s4ws_8r3h_z5_czyw0000gn/T/grok-goal-5e32f7b48590/implementer/graph.png',
				fullPage: true
			});
			await page.locator('#cdvFiles .file-row', { hasText: 'README.md' }).click();
			await page.waitForSelector('.monaco-diff-editor.side-by-side', { timeout: 15000 });
			await page.waitForTimeout(800);
			const diffUi = await page.evaluate(() => {
				const host = document.getElementById('monacoHost');
				const hostBox = host ? host.getBoundingClientRect() : { width: 0, height: 0 };
				const norm = (s) => String(s || '').replace(/\u00a0/g, ' ');
				const panes = [...document.querySelectorAll('.editor.original, .editor.modified')].map((el) => {
					const box = el.getBoundingClientRect();
					return { w: Math.round(box.width), h: Math.round(box.height), text: norm(el.innerText) };
				});
				const visiblePanes = panes.filter((p) => p.w > 200 && p.h > 120);
				const models = window.monaco?.editor?.getModels?.().map((m) => m.getValue()) || [];
				const line = document.querySelector('.monaco-editor .view-line');
				let contrastOk = false;
				if (line) {
					const color = getComputedStyle(line).color;
					const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
					if (m) contrastOk = Number(m[1]) + Number(m[2]) + Number(m[3]) > 300;
				}
				return {
					hostW: Math.round(hostBox.width),
					hostH: Math.round(hostBox.height),
					paneCount: panes.length,
					visiblePanes: visiblePanes.length,
					leftVisible: visiblePanes.some((p) => p.text.includes('hello world')),
					rightVisible: visiblePanes.some((p) => p.text.includes('hello feature')),
					contrastOk,
					models
				};
			});
			assert.ok(diffUi.hostW > 800 && diffUi.hostH > 300, `diff surface too small: ${JSON.stringify(diffUi)}`);
			assert.ok(diffUi.visiblePanes >= 2, `expected two laid-out Monaco panes, got ${JSON.stringify(diffUi)}`);
			assert.ok(diffUi.leftVisible && diffUi.rightVisible, 'both revision texts must be visible on screen, not only in models');
			assert.ok(diffUi.contrastOk, 'diff text must not be dark-on-dark');
			assert.ok(diffUi.models.some((text) => text.includes('hello world')), 'left revision missing');
			assert.ok(diffUi.models.some((text) => text.includes('hello feature')), 'right revision missing');

			await page.locator('#diffClose').click();
			await page.locator('tr.commit', { hasText: 'merge feature into main' }).click({
				modifiers: ['ControlOrMeta']
			});
			await page.waitForFunction(() => document.querySelector('#cdvSummary h3')?.textContent === 'Compare');
			const compareCount = await page.locator('#cdvFiles .file-row').count();
			assert.ok(compareCount > 0, 'compare must list changed files');
			const compareSummary = await page.locator('#cdvSummary').innerText();
			assert.match(compareSummary, /From:/);
			assert.match(compareSummary, /To:/);

			await page.route('**/api/diff?*', async (route) => {
				await route.fulfill({
					status: 400,
					contentType: 'application/json; charset=utf-8',
					body: JSON.stringify({ error: 'diff load failed for test' })
				});
			});
			await page.locator('#cdvFiles .file-row').first().click();
			await page.waitForSelector('#errorBanner:not([hidden])', { timeout: 8000 });
			assert.match(await page.locator('#errorBanner').innerText(), /diff load failed for test/);
			await page.unroute('**/api/diff?*');

			await page.locator('tr.commit', { hasText: 'merge feature into main' }).click({ button: 'right' });
			await page.locator('#contextMenu button', { hasText: 'Create branch' }).click();
			await page.fill('#branchName', 'main');
			await page.click('#dialogOk');
			await page.waitForFunction(
				() =>
					document.querySelector('#errorBanner') &&
					!document.querySelector('#errorBanner').hidden &&
					/already exists|fatal/i.test(document.querySelector('#errorBanner').textContent || '')
			);
			assert.equal(errors.length, 0, errors.join('\n'));
		} finally {
			await browser.close();
		}
	});

	it('right-clicking combined origin/main pill opens the remote-branch menu', async (t) => {
		if (!chromium) {
			t.skip('playwright is not installed');
			return;
		}
		let browser;
		try {
			browser = await chromium.launch({ headless: true });
		} catch (err) {
			t.skip(`chromium unavailable: ${err.message}`);
			return;
		}
		const page = await graphPage(browser);
		try {
			await page.goto(listening.url, { waitUntil: 'networkidle' });
			await page.waitForSelector('tr.commit', { timeout: 10000 });
			const nested = await page.evaluate(() => {
				const origin = document.querySelector('.gitRef.head .gitRef[data-ref-type="remote"]');
				return origin
					? { name: origin.getAttribute('data-name'), text: origin.textContent }
					: null;
			});
			assert.ok(nested, 'combined local+remote pill must nest a remote gitRef');
			assert.equal(nested.name, 'origin/main');
			assert.equal(nested.text, 'origin');
			await page.locator('.gitRef.head .gitRef[data-ref-type="remote"]').click({ button: 'right' });
			await page.waitForSelector('#contextMenu button', { timeout: 5000 });
			const labels = await page.locator('#contextMenu button').allTextContents();
			assert.ok(
				labels.some((l) => /Delete remote branch/i.test(l)),
				`expected remote menu, got: ${labels.join(' | ')}`
			);
			assert.ok(labels.some((l) => /Pull into current branch/i.test(l)));
			assert.ok(labels.some((l) => /Fetch into local branch/i.test(l)));
			assert.equal(
				labels.some((l) => /Rename branch/i.test(l)),
				false,
				'combined origin suffix must not open the local-head menu'
			);
		} finally {
			await browser.close();
		}
	});

	it('reset from the commit menu is not Unknown API route and moves HEAD', async (t) => {
		if (!chromium) {
			t.skip('playwright is not installed');
			return;
		}
		let browser;
		let isolated;
		let isoServer;
		try {
			browser = await chromium.launch({ headless: true });
		} catch (err) {
			t.skip(`chromium unavailable: ${err.message}`);
			return;
		}
		try {
			isolated = await createFixtureRepo();
			isoServer = await listenGitGraph({ repo: isolated.repo, host: '127.0.0.1', port: 0 });
			const page = await graphPage(browser);
			await page.goto(isoServer.url, { waitUntil: 'networkidle' });
			await page.waitForSelector('tr.commit', { timeout: 10000 });
			await page.locator('tr.commit', { hasText: 'add feature work' }).click({ button: 'right' });
			await page.locator('#contextMenu button', { hasText: 'Reset current branch' }).click();
			await page.waitForSelector('#dialog:not([hidden])');
			await page.click('#dialogOk');
			await page.waitForFunction(() => document.getElementById('dialog')?.hidden !== false);
			const banner = await page.locator('#errorBanner').innerText().catch(() => '');
			assert.doesNotMatch(banner, /Unknown API route/i);
			const commits = await (await fetch(new URL('/api/commits', isoServer.url))).json();
			assert.equal(commits.head, isolated.hashes.feature);
			assert.equal(commits.branch, 'main');
		} finally {
			await browser.close();
			if (isoServer?.server) await new Promise((resolve) => isoServer.server.close(resolve));
			if (isolated?.repo) await fs.rm(isolated.repo, { recursive: true, force: true });
		}
	});

	async function menuLabels(page, locator) {
		await locator.click({ button: 'right' });
		await page.waitForSelector('#contextMenu button', { timeout: 5000 });
		return page.locator('#contextMenu button').allTextContents();
	}

	it('toolbar chrome is present and Find opens hits', async (t) => {
		if (!chromium) {
			t.skip('playwright is not installed');
			return;
		}
		let browser;
		try {
			browser = await chromium.launch({ headless: true });
		} catch (err) {
			t.skip(`chromium unavailable: ${err.message}`);
			return;
		}
		const page = await graphPage(browser);
		try {
			await page.goto(listening.url, { waitUntil: 'networkidle' });
			await page.waitForSelector('tr.commit', { timeout: 10000 });
			for (const id of [
				'fetchBtn',
				'findBtn',
				'refreshBtn',
				'themeBtn',
				'branchFilter',
				'showRemotes',
				'showStashes'
			]) {
				assert.equal(await page.locator('#' + id).count(), 1, `missing #${id}`);
			}
			assert.equal(await page.locator('#loadMore').count(), 1);
			await page.click('#findBtn');
			assert.equal(await page.locator('#findBar').isHidden(), false);
			await page.fill('#findInput', 'feature work');
			await page.waitForFunction(() => document.querySelectorAll('tr.commit.find-hit').length > 0);
			assert.ok((await page.locator('tr.commit.find-hit').count()) >= 1);
		} finally {
			await browser.close();
		}
	});

	it('commit, branch, tag, and uncommitted menus list shipped actions', async (t) => {
		if (!chromium) {
			t.skip('playwright is not installed');
			return;
		}
		let browser;
		try {
			browser = await chromium.launch({ headless: true });
		} catch (err) {
			t.skip(`chromium unavailable: ${err.message}`);
			return;
		}
		const page = await graphPage(browser);
		try {
			await page.goto(listening.url, { waitUntil: 'networkidle' });
			await page.waitForSelector('tr.commit', { timeout: 10000 });

			const commitMenu = await menuLabels(page, page.locator('tr.commit', { hasText: 'add feature work' }));
			for (const label of [
				'Add tag',
				'Create branch',
				'Checkout branch',
				'Cherry pick',
				'Revert',
				'Drop commit',
				'Merge into current branch',
				'Reset current branch',
				'Copy commit hash'
			]) {
				assert.ok(commitMenu.some((l) => l.includes(label)), `commit menu missing ${label}: ${commitMenu.join(' | ')}`);
			}

			await page.keyboard.press('Escape');
			const branchMenu = await menuLabels(page, page.locator('.gitRef.head[data-name="feature"]'));
			for (const label of ['Rename branch', 'Delete branch', 'Merge into current branch', 'Copy branch name']) {
				assert.ok(branchMenu.some((l) => l.includes(label)), `branch menu missing ${label}: ${branchMenu.join(' | ')}`);
			}

			await page.keyboard.press('Escape');
			const tagMenu = await menuLabels(page, page.locator('.gitRef.tag[data-name="v1.0"]'));
			for (const label of ['View details', 'Delete tag', 'Copy tag name']) {
				assert.ok(tagMenu.some((l) => l.includes(label)), `tag menu missing ${label}: ${tagMenu.join(' | ')}`);
			}

			await page.keyboard.press('Escape');
			const unMenu = await menuLabels(page, page.locator('tr.commit', { hasText: 'Uncommitted Changes' }));
			for (const label of ['Stash uncommitted changes', 'Reset uncommitted changes', 'Clean untracked files']) {
				assert.ok(unMenu.some((l) => l.includes(label)), `uncommitted menu missing ${label}: ${unMenu.join(' | ')}`);
			}
		} finally {
			await browser.close();
		}
	});

	it('follows prefers-color-scheme: light and the toolbar toggle switches theme', async (t) => {
		if (!chromium) {
			t.skip('playwright is not installed');
			return;
		}
		let browser;
		try {
			browser = await chromium.launch({ headless: true });
		} catch (err) {
			t.skip(`chromium unavailable: ${err.message}`);
			return;
		}
		const page = await graphPage(browser, 'light');
		try {
			await page.goto(listening.url, { waitUntil: 'networkidle' });
			await page.waitForSelector('tr.commit', { timeout: 10000 });
			const light = await page.evaluate(() => {
				const bg = getComputedStyle(document.body).backgroundColor;
				const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
				const sum = m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : 0;
				const fg = getComputedStyle(document.body).color;
				const fm = fg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
				const fgSum = fm ? Number(fm[1]) + Number(fm[2]) + Number(fm[3]) : 0;
				return {
					theme: document.documentElement.getAttribute('data-theme'),
					bgSum: sum,
					fgSum,
					btn: document.getElementById('themeBtn')?.textContent
				};
			});
			assert.equal(light.theme, 'light');
			assert.ok(light.bgSum > 600, `expected light background, got ${JSON.stringify(light)}`);
			assert.ok(light.fgSum < 400, `expected dark text, got ${JSON.stringify(light)}`);
			assert.equal(light.btn, 'Dark');

			await page.click('#themeBtn');
			const afterDark = await page.evaluate(() => ({
				theme: document.documentElement.getAttribute('data-theme'),
				stored: localStorage.getItem('gitlane-theme'),
				bg: getComputedStyle(document.body).backgroundColor,
				btn: document.getElementById('themeBtn')?.textContent
			}));
			assert.equal(afterDark.theme, 'dark');
			assert.equal(afterDark.stored, 'dark');
			assert.equal(afterDark.btn, 'Light');
			const darkBg = afterDark.bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
			const darkSum = darkBg ? Number(darkBg[1]) + Number(darkBg[2]) + Number(darkBg[3]) : 999;
			assert.ok(darkSum < 200, `expected dark background after toggle, got ${afterDark.bg}`);

			await page.click('#themeBtn');
			await page.locator('tr.commit', { hasText: 'add feature work' }).click();
			await page.waitForSelector('#cdvFiles .file-row', { timeout: 8000 });
			await page.locator('#cdvFiles .file-row', { hasText: 'README.md' }).click();
			await page.waitForSelector('.monaco-diff-editor.side-by-side', { timeout: 15000 });
			await page.waitForTimeout(400);
			const monaco = await page.evaluate(() => {
				const theme = document.documentElement.getAttribute('data-theme');
				const line = document.querySelector('.monaco-editor .view-line');
				let textSum = 0;
				if (line) {
					const color = getComputedStyle(line).color;
					const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
					if (m) textSum = Number(m[1]) + Number(m[2]) + Number(m[3]);
				}
				const host = document.getElementById('monacoHost');
				const hostBg = host ? getComputedStyle(host).backgroundColor : '';
				return { theme, textSum, hostBg };
			});
			assert.equal(monaco.theme, 'light');
			assert.ok(monaco.textSum < 400, `light Monaco text should be dark, got ${JSON.stringify(monaco)}`);
		} finally {
			await browser.close();
		}
	});
});
