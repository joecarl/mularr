import { component, signal } from 'chispa';
import tpl from './AddServerDialog.html';
import { bindInput } from '../../utils/chispaHelpers';

export interface AddServerDialogProps {
	onConfirm: (server: { ip: string; port: number; name?: string }) => void;
	onCancel: () => void;
}

export const AddServerDialog = component<AddServerDialogProps>(({ onConfirm, onCancel }) => {
	const formName = signal('');
	const formIp = signal('');
	const formPort = signal('4661');

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		const ip = formIp.get().trim();
		const port = Number(formPort.get());
		if (!ip || !port || port < 1 || port > 65535) return;
		onConfirm({ ip, port, name: formName.get().trim() || undefined });
	};

	return tpl.fragment({
		form: { onsubmit: handleSubmit },
		name: { _ref: bindInput(formName) },
		ip: { _ref: bindInput(formIp) },
		port: { _ref: bindInput(formPort) },
		btnCancel: { onclick: onCancel },
	});
});
