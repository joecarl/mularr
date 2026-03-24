import { ContextMenuHost, type ContextMenuItem } from '../components/ContextMenuHost';

export type { ContextMenuItem };

export class ContextMenuService {
	private currentMenu: ReturnType<typeof ContextMenuHost> | null = null;

	show(event: MouseEvent, items: ContextMenuItem[]): void {
		event.preventDefault();
		event.stopPropagation();

		// Close any existing menu first
		this.close();

		if (items.length === 0) return;

		const x = event.clientX;
		const y = event.clientY;

		const menuInstance = ContextMenuHost({
			x,
			y,
			items: items,
			onClose: () => this.close(),
		});

		this.currentMenu = menuInstance;
		menuInstance.mount(document.body);
	}

	close(): void {
		if (this.currentMenu) {
			this.currentMenu.unmount();
			this.currentMenu = null;
		}
	}
}
