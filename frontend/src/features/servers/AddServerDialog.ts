import { component, signal, refBindInput } from 'chispa';
import tpl from './AddServerDialog.html';

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
		name: { _ref: refBindInput(formName) },
		ip: { _ref: refBindInput(formIp) },
		port: { _ref: refBindInput(formPort) },
		btnCancel: { onclick: onCancel },
	});
});
