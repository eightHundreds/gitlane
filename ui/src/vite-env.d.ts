/// <reference types="svelte" />
/// <reference types="vite/client" />

interface Window {
	require?: (deps: string[], cb: () => void) => void;
	monaco?: {
		editor: {
			defineTheme: (name: string, def: unknown) => void;
			setTheme: (name: string) => void;
			create: (el: HTMLElement, opts: Record<string, unknown>) => { dispose: () => void; layout: () => void };
			createDiffEditor: (el: HTMLElement, opts: Record<string, unknown>) => {
				dispose: () => void;
				layout: () => void;
				setModel: (m: unknown) => void;
			};
			createModel: (value: string, lang: string) => { dispose: () => void };
			getModels?: () => { getValue: () => string }[];
		};
	};
	MonacoEnvironment?: { getWorkerUrl: () => string };
}
