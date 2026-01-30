import { component, Link, pathMatches } from 'chispa';
import { getIcon } from '../utils/Icons';
import tpl from './Sidebar.html';
import './Sidebar.css';

export const Sidebar = component(() => {
	const linksData = [
		{ to: '/', inner: [getIcon('layout-dashboard'), ' Dashboard'] },
		{ to: '/settings', inner: [getIcon('settings'), ' Configuración'] },
	];

	// Como linksData es un array que no va a cambiar, podemos crear una
	// lista de componentes Link sin necesidad de usar componentList,
	const links = linksData.map((link) =>
		Link({
			to: link.to,
			inner: link.inner,
			classes: { 'nav-link': true, 'active-link': pathMatches(link.to) },
		})
	);

	return tpl.fragment({
		navLinks: { inner: links },
	});
});
