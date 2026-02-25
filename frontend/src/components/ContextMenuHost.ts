import { component } from 'chispa';
import tpl from './ContextMenuHost.html';
import '../styles/ui-context-menu.css';

export interface ContextMenuAction {
	label: string;
	icon?: string;
	disabled?: boolean;
	onClick: () => void;
}

export interface IContextMenuProps {
	x: number;
	y: number;
	actions: ContextMenuAction[];
	onClose: () => void;
}

export const ContextMenuHost = component<IContextMenuProps>(({ x, y, actions, onClose }) => {
	const buildItems = () =>
		actions.map((action) =>
			tpl.menuItem({
				classes: { 'ctx-menu-item-disabled': () => !!action.disabled },
				onclick: !action.disabled
					? (e: MouseEvent) => {
							e.stopPropagation();
							action.onClick();
							onClose();
						}
					: undefined,
				nodes: {
					menuItemIcon: {
						inner: action.icon ?? '',
						style: { display: action.icon ? '' : 'none' },
					},
					menuItemLabel: {
						inner: action.label,
					},
				},
			})
		);

	// Adjust position so menu stays within viewport
	const adjustedX = Math.min(x, window.innerWidth - 180);
	const adjustedY = Math.min(y, window.innerHeight - actions.length * 34 - 10);

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
