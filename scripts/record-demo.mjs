import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { listenGitGraph } from '../src/server.js';
import { createFixtureRepo } from '../test/helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'demo.gif');
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

function run(cmd, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: 'inherit' });
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${cmd} exited ${code}`));
		});
	});
}

async function moveTo(page, locator) {
	const box = await locator.boundingBox();
	if (!box) throw new Error('locator has no box');
	await page.mouse.move(box.x + Math.min(box.width / 2, 80), box.y + box.height / 2, { steps: 18 });
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlane-demo-'));
const fx = await createFixtureRepo();
const demoRepo = '/tmp/my-app';
await fs.rm(demoRepo, { recursive: true, force: true });
await fs.cp(fx.repo, demoRepo, { recursive: true });
await fs.rm(fx.repo, { recursive: true, force: true });
const listening = await listenGitGraph({ repo: demoRepo, host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1200, height: 740 },
	colorScheme: 'dark',
	recordVideo: { dir: tmp, size: { width: 1200, height: 740 } }
});
const page = await context.newPage();
await page.addInitScript(() => {
	const style = document.createElement('style');
	style.textContent = `#demo-cursor{position:fixed;z-index:99999;width:16px;height:16px;margin:-8px 0 0 -8px;border:2px solid #fff;background:rgba(37,99,235,.9);border-radius:50%;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,.45)}#demo-cursor.clicking{transform:scale(.72)}`;
	document.documentElement.appendChild(style);
	window.addEventListener('DOMContentLoaded', () => {
		const cursor = document.createElement('div');
		cursor.id = 'demo-cursor';
		document.body.appendChild(cursor);
		window.addEventListener(
			'mousemove',
			(e) => {
				cursor.style.left = `${e.clientX}px`;
				cursor.style.top = `${e.clientY}px`;
			},
			true
		);
		window.addEventListener('mousedown', () => cursor.classList.add('clicking'), true);
		window.addEventListener('mouseup', () => cursor.classList.remove('clicking'), true);
	});
});

try {
	await page.goto(listening.url, { waitUntil: 'networkidle' });
	await page.waitForSelector('tr.commit');
	await page.waitForSelector('#commitGraph circle');
	await page.waitForTimeout(1400);

	const feature = page.locator('tr.commit', { hasText: 'add feature work' });
	await moveTo(page, feature);
	await page.waitForTimeout(250);
	await feature.click();
	await page.waitForSelector('#cdvFiles .file-row');
	await page.waitForTimeout(1100);

	const fileRow = page.locator('#cdvFiles .file-row', { hasText: 'README.md' });
	await moveTo(page, fileRow);
	await page.waitForTimeout(200);
	await fileRow.click();
	await page.waitForSelector('.monaco-diff-editor.side-by-side');
	await page.waitForTimeout(1800);

	await moveTo(page, page.locator('#diffClose'));
	await page.locator('#diffClose').click();
	await page.waitForTimeout(450);

	const merge = page.locator('tr.commit', { hasText: 'merge feature into main' });
	await moveTo(page, merge);
	await page.waitForTimeout(200);
	await merge.click({ modifiers: [modifier] });
	await page.waitForFunction(() => document.querySelector('#cdvSummary h3')?.textContent === 'Compare');
	await page.waitForTimeout(1300);

	await page.keyboard.press('Escape');
	await page.waitForTimeout(400);

	const branch = page.locator('.gitRef.head[data-name="feature"]');
	await moveTo(page, branch);
	await page.waitForTimeout(200);
	await branch.click({ button: 'right' });
	await page.waitForSelector('#contextMenu button');
	await page.waitForTimeout(1400);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(350);

	const remote = page.locator('.gitRef.head .gitRef[data-ref-type="remote"]').first();
	await moveTo(page, remote);
	await page.waitForTimeout(200);
	await remote.click({ button: 'right' });
	await page.waitForSelector('#contextMenu button');
	await page.waitForTimeout(1300);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(900);
} finally {
	const video = page.video();
	await context.close();
	await browser.close();
	await new Promise((resolve) => listening.server.close(resolve));
	await fs.rm(demoRepo, { recursive: true, force: true });

	const videoPath = await video.path();
	await fs.mkdir(path.dirname(OUT), { recursive: true });
	await run('ffmpeg', [
		'-y',
		'-i',
		videoPath,
		'-vf',
		'fps=10,scale=1080:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5',
		OUT
	]);
	await fs.rm(tmp, { recursive: true, force: true });
	const st = await fs.stat(OUT);
	console.log(`wrote ${OUT} (${Math.round(st.size / 1024)} KiB)`);
}
