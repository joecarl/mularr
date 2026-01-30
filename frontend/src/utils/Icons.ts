/**
 * Returns an HTML string for an icon.
 * @param iconName The icon class name (without icon- prefix or from ICONS)
 * @param size Optional font size
 * @param color Optional color
 * @returns HTML string
 */
export function getIcon(iconName: string, size?: number, color?: string) {
	// If it's a known shorthand or already has the prefix, use it as is
	// Otherwise, prepend 'icon-'
	const className = iconName.startsWith('icon-') ? iconName : `icon-${iconName}`;

	let style = '';
	if (size || color) {
		style = ' style="';
		if (size) style += `font-size: ${size}px;`;
		if (color) style += `color: ${color};`;
		style += '"';
	}
	const aux = document.createElement('div');
	aux.innerHTML = `<i class="${className}"${style}></i>`;
	return aux.firstChild;
}
