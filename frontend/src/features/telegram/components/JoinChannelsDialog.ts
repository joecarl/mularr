import { component, computed, refBindCheckbox, refBindInput, signal } from 'chispa';
import tpl from './JoinChannelsDialog.html';

export interface JoinChannelsDialogProps {
	/** Receives the non-empty lines as pasted (the backend parses them) and whether to index the chats once joined. */
	onConfirm: (links: string[], indexOnJoin: boolean) => void;
	onCancel: () => void;
}

/** A textarea for channel links, one per line, and the choice of indexing the chats once joined. */
export const JoinChannelsDialog = component<JoinChannelsDialogProps>(({ onConfirm, onCancel }) => {
	const text = signal('');
	const indexOnJoin = signal(true);
	const lines = computed(() =>
		text
			.get()
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean)
	);

	return tpl.fragment({
		linksInput: {
			_ref: refBindInput(text),
		},
		indexCheck: {
			_ref: refBindCheckbox(indexOnJoin),
		},
		countText: {
			inner: () => {
				const n = lines.get().length;
				return n === 0 ? '' : n === 1 ? '1 link' : `${n} links`;
			},
		},
		btnOk: {
			disabled: () => lines.get().length === 0,
			onclick: () => onConfirm(lines.get(), indexOnJoin.get()),
		},
		btnCancel: {
			onclick: onCancel,
		},
	});
});
