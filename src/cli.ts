#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveRepo } from './git.js';
import { listenGitGraph, monacoMinDir } from './server.js';

export function parseCliArgs(argv: string[]) {
	let repo: string | null = null;
	let port = 3840;
	let host = '127.0.0.1';
	let openBrowser = true;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--port' || a === '-p') port = Number(argv[++i]);
		else if (a === '--host') host = argv[++i] || host;
		else if (a === '--no-open') openBrowser = false;
		else if (a === '--repo' || a === '-r') repo = argv[++i] || repo;
		else if (a === '--help' || a === '-h') {
			return { repo, port, host, openBrowser, help: true };
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

async function tryOpenBrowser(url: string) {
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
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Could not open a browser automatically: ${message}`);
		console.error(`Open ${url} manually.`);
	}
}

export async function startFromArgs(argv: string[], options: { open?: boolean } = {}) {
	const parsed = parseCliArgs(argv);
	if (parsed.help) {
		printUsage();
		return { help: true };
	}
	const repoInput = parsed.repo || process.cwd();
	const repo = await resolveRepo(repoInput);
	monacoMinDir();
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
	startFromArgs(process.argv.slice(2)).catch((err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		console.error(message || err);
		if (message.includes('not a git')) {
			printUsage();
		}
		process.exit(1);
	});
}
