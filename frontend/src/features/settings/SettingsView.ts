import { component, signal, bindControlledInput, bindControlledSelect } from 'chispa';
import tpl from './SettingsView.html';

export const SettingsView = component(() => {
	const theme = signal('light');
	const interval = signal(2000);

	return tpl.fragment({
		themeSelect: {
			_ref: (el) => {
				bindControlledSelect(el, theme);
			},
		},
		intervalInput: {
			_ref: (el) => {
				bindControlledInput(el, interval);
			},
		},
	});
});
