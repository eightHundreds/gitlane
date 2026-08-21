import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root,
	plugins: [svelte()],
	resolve: {
		alias: {
			'@gitlane': path.resolve(root, '../src')
		}
	},
	build: {
		outDir: path.resolve(root, '../dist/ui'),
		emptyOutDir: true,
		sourcemap: true
	},
	server: {
		fs: { allow: [path.resolve(root, '..')] }
	}
});
