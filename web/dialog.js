import { els, showError } from './dom.js';
import { escapeHtml } from './escape.js';

export function hideMenu() {
	els.contextMenu.hidden = true;
}

export function showMenu(x, y, items) {
	els.contextMenu.innerHTML = items
		.map((item, i) =>
			item.separator
				? '<div class="menu-sep"></div>'
				: `<button type="button" data-i="${i}">${escapeHtml(item.label)}</button>`
		)
		.join('');
	els.contextMenu.hidden = false;
	els.contextMenu.style.left = `${x}px`;
	els.contextMenu.style.top = `${y}px`;
	els.contextMenu.querySelectorAll('button').forEach((btn) => {
		btn.addEventListener('click', () => {
			hideMenu();
			const item = items[Number(btn.dataset.i)];
			if (item?.run) item.run();
		});
	});
}

export function promptDialog({ title, bodyHtml, onOk }) {
	els.dialogTitle.textContent = title;
	els.dialogBody.innerHTML = bodyHtml;
	els.dialog.hidden = false;
	const finish = async (ok) => {
		els.dialogOk.onclick = null;
		els.dialogCancel.onclick = null;
		if (ok) {
			try {
				await onOk();
			} catch (err) {
				showError(err.message);
			}
		}
		els.dialog.hidden = true;
	};
	els.dialogOk.onclick = () => {
		finish(true);
	};
	els.dialogCancel.onclick = () => {
		finish(false);
	};
}
