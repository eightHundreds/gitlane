export type MenuItem = { separator?: boolean; label?: string; run?: () => void };

export const overlays = $state({
	menu: null as { x: number; y: number; items: MenuItem[] } | null,
	dialog: null as { title: string; bodyHtml: string; onOk: () => Promise<void> } | null,
	error: ''
});

export function hideMenu() {
	overlays.menu = null;
}

export function showMenu(x: number, y: number, items: MenuItem[]) {
	overlays.menu = { x, y, items };
}

export function promptDialog(opts: { title: string; bodyHtml: string; onOk: () => Promise<void> }) {
	overlays.dialog = opts;
}

export function closeDialog() {
	overlays.dialog = null;
}

export function showError(message: string) {
	overlays.error = String(message || 'Request failed');
}

export function clearError() {
	overlays.error = '';
}

export function fieldValue(id: string) {
	return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
}

export function fieldChecked(id: string) {
	return Boolean((document.getElementById(id) as HTMLInputElement | null)?.checked);
}
