import { component } from 'chispa';
import tpl from './ContextMenuHost.html';
import '../styles/ui-context-menu.css';

export interface ContextMenuAction {
	label: string;
	icon?: string;
	disabled?: boolean;
	onClick: () => void;
}

export interface ContextMenuSeparator {
	separator: true;
}

export type ContextMenuItem = ContextMenuSeparator | ContextMenuAction;

function isSeparator(item: ContextMenuItem): item is ContextMenuSeparator {
	return 'separator' in item;
}

export interface IContextMenuProps {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
}

export const ContextMenuHost = component<IContextMenuProps>(({ x, y, items, onClose }) => {
	const buildItems = () =>
		items.map((item) => {
			if (isSeparator(item)) {
				return tpl.menuSeparator({});
			}
			return tpl.menuItem({
				classes: { 'ctx-menu-item-disabled': () => !!item.disabled },
				onclick: !item.disabled
					? (e: MouseEvent) => {
							e.stopPropagation();
							item.onClick();
							onClose();
						}
					: undefined,
				nodes: {
					menuItemIcon: {
						inner: item.icon ?? '',
						style: { display: item.icon ? '' : 'none' },
					},
					menuItemLabel: {
						inner: item.label,
					},
				},
			});
		});

	// Adjust position so menu stays within viewport
	const itemCount = items.filter((a) => !isSeparator(a)).length;
	const adjustedX = Math.min(x, window.innerWidth - 180);
	const adjustedY = Math.min(y, window.innerHeight - itemCount * 34 - 10);

	return tpl.fragment({
		overlay: {
			onclick: (e: MouseEvent) => {
				if ((e.target as HTMLElement).closest('.ctx-menu') === null) {
					onClose();
				}
			},
			oncontextmenu: (e: MouseEvent) => {
				e.preventDefault();
				onClose();
				// After the overlay is removed from DOM, re-dispatch to the element below
				const below = document.elementFromPoint(e.clientX, e.clientY);
				if (below) {
					below.dispatchEvent(
						new MouseEvent('contextmenu', {
							bubbles: true,
							cancelable: true,
							clientX: e.clientX,
							clientY: e.clientY,
							screenX: e.screenX,
							screenY: e.screenY,
						})
					);
				}
			},
		},
		container: {
			style: {
				left: `${adjustedX}px`,
				top: `${adjustedY}px`,
			},
		},
		menu: {
			inner: buildItems(),
		},
	});
});
