import { ContextMenuHost, type ContextMenuAction } from '../components/ContextMenuHost';

export type { ContextMenuAction };

export class ContextMenuService {
	private currentMenu: ReturnType<typeof ContextMenuHost> | null = null;

	show(event: MouseEvent, actions: ContextMenuAction[]): void {
		event.preventDefault();
		event.stopPropagation();

		// Close any existing menu first
		this.close();

		if (actions.length === 0) return;

		const x = event.clientX;
		const y = event.clientY;

		const menuInstance = ContextMenuHost({
			x,
			y,
			actions,
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
