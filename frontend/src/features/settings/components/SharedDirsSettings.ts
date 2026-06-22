import { bindControlledCheckbox, bindControlledInput, component, inject, signal, WritableSignal } from 'chispa';
import { SharedDirectoryEntry } from '../../../services/AmuleApiService';
import { DialogService } from '../../../services/DialogService';
import tpl from './SharedDirsSettings.html';

export interface SharedDirsSettingsProps {
	sharedDirs: WritableSignal<SharedDirectoryEntry[]>;
	isLocked: () => boolean;
}

export const SharedDirsSettings = component<SharedDirsSettingsProps>(({ sharedDirs, isLocked }) => {
	const dialogService = inject(DialogService);
	const newPath = signal('');
	const newRecursive = signal(true);

	const addSharedDir = async (path: string, recursive: boolean) => {
		const trimmedPath = path.trim();
		if (!trimmedPath) {
			return;
		}

		if (!trimmedPath.startsWith('/')) {
			await dialogService.alert(`Shared directory path must be absolute: ${trimmedPath}`, 'Invalid shared directory');
			return;
		}

		const next = [...sharedDirs.get()];
		const existingIndex = next.findIndex((entry) => entry.path === trimmedPath);
		if (existingIndex >= 0) {
			next[existingIndex] = {
				...next[existingIndex],
				recursive: next[existingIndex].recursive || recursive,
			};
		} else {
			next.push({ path: trimmedPath, recursive });
		}

		sharedDirs.set(next);
	};

	const removeSharedDirAt = (index: number) => {
		const next = sharedDirs.get().filter((_, idx) => idx !== index);
		sharedDirs.set(next);
	};

	const updateSharedDirRecursive = (index: number, recursive: boolean) => {
		const next = [...sharedDirs.get()];
		if (!next[index]) return;
		next[index] = { ...next[index], recursive };
		sharedDirs.set(next);
	};

	return tpl.fragment({
		lockedSharedDirsInfo: {
			style: {
				display: () => (isLocked() ? '' : 'none'),
			},
		},
		newSharedDirPath: {
			disabled: () => isLocked(),
			_ref: (el) => {
				bindControlledInput(el, newPath);
			},
		},
		newSharedDirRecursive: {
			disabled: () => isLocked(),
			_ref: (el) => {
				bindControlledCheckbox(el, newRecursive);
			},
		},
		addSharedDirBtn: {
			disabled: () => isLocked(),
			onclick: async () => {
				await addSharedDir(newPath.get(), newRecursive.get());
				newPath.set('');
				newRecursive.set(true);
			},
		},
		sharedDirsTableBody: {
			inner: () => {
				const list = sharedDirs.get();
				if (list.length === 0) {
					return tpl.sharedDirNoRows({});
				}

				return list.map((entry, index) =>
					tpl.sharedDirTableRow({
						nodes: {
							sharedDirPathCell: {
								inner: entry.path,
							},
							sharedDirRecursive: {
								checked: entry.recursive,
								disabled: () => isLocked(),
								onchange: (event: Event) => {
									updateSharedDirRecursive(index, (event.target as HTMLInputElement).checked);
								},
							},
							removeSharedDirBtn: {
								disabled: () => isLocked(),
								onclick: () => removeSharedDirAt(index),
							},
						},
					})
				);
			},
		},
	});
});
