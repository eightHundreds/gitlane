#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveRepo } from './git.js';
import { listenGitGraph } from './server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONACO_LOADER = path.join(ROOT, 'node_modules', 'monaco-editor', 'min', 'vs', 'loader.js');

export function parseCliArgs(argv) {
	let repo = null;
	let port = 3840;
	let host = '127.0.0.1';
	let openBrowser = true;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--port' || a === '-p') port = Number(argv[++i]);
		else if (a === '--host') host = argv[++i];
		else if (a === '--no-open') openBrowser = false;
		else if (a === '--repo' || a === '-r') repo = argv[++i];
		else if (a === '--help' || a === '-h') {
			return { help: true };
		} else if (!a.startsWith('-')) {
			repo = a;
		} else {
			throw new Error(`Unknown argument: ${a}`);
		}
	}
	return { repo, port, host, openBrowser, help: false };
}

export function printUsage() {
	console.log(`Usage: gitlane <repo-path> [--port 3840] [--host 127.0.0.1] [--no-open]

Start a local web server that reads/writes the given git repository and
opens Gitlane in the browser (Monaco diffs).`);
}

async function tryOpenBrowser(url) {
	try {
		const { spawn } = await import('node:child_process');
		const platform = process.platform;
		if (platform === 'darwin') {
			spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
		} else if (platform === 'win32') {
			spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
		} else {
			spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
		}
	} catch (err) {
		console.error(`Could not open a browser automatically: ${err.message}`);
		console.error(`Open ${url} manually.`);
	}
}

export async function startFromArgs(argv, options = {}) {
	const parsed = parseCliArgs(argv);
	if (parsed.help) {
		printUsage();
		return { help: true };
	}
	const repoInput = parsed.repo || process.cwd();
	const repo = await resolveRepo(repoInput);
	if (!existsSync(MONACO_LOADER)) {
		throw new Error('monaco-editor is missing. Run npm install in the project root.');
	}
	const listening = await listenGitGraph({
		repo,
		host: parsed.host,
		port: parsed.port
	});
	console.log('Gitlane');
	console.log(`  repo: ${repo}`);
	console.log(`  url:  ${listening.url}`);
	if (parsed.openBrowser && options.open !== false) {
		await tryOpenBrowser(listening.url);
	}
	return listening;
}

function isMainModule() {
	if (process.execArgv.some((a) => a === '--test' || a.startsWith('--test='))) return false;
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return import.meta.url === pathToFileURL(path.resolve(entry)).href;
	} catch {
		return false;
	}
}

if (isMainModule()) {
	startFromArgs(process.argv.slice(2)).catch((err) => {
		console.error(err.message || err);
		if (String(err.message || '').includes('not a git')) {
			printUsage();
		}
		process.exit(1);
	});
}
