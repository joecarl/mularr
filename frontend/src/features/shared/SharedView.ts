import { component, signal, computed, componentList } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AmuleApiService, AmuleFile } from '../../services/AmuleApiService';
import { getFileIcon } from '../../utils/Icons';
import { formatBytes } from '../../utils/formats';
import { smartPoll } from '../../utils/scheduling';
import tpl from './SharedView.html';
import './SharedView.css';

const fbytes = (bytes?: number) => {
	const b = formatBytes(bytes || 0);
	return `${b.text} ${b.unit}`;
};

const SharedRows = componentList<AmuleFile>(
	(t, i, l, props) => {
		return tpl.sharedRow({
			nodes: {
				nameCol: {},
				sharedNameText: { inner: () => t.get().name || 'Unknown' },
				sharedIcon: { inner: () => getFileIcon(t.get().name || '') },
				sizeCol: { inner: () => fbytes(t.get().size) },
				ratingCol: { inner: () => t.get().getRating ?? 0 },
				requestsCol: { inner: () => (t.get().getRequests ?? 0) + ' (' + (t.get().getAllRequests ?? 0) + ')' },
				transferredCol: { inner: () => fbytes(t.get().getXferred ?? 0) + ' (' + fbytes(t.get().getAllXferred ?? 0) + ')' },
				completeSourcesCol: { inner: () => t.get().getCompleteSources ?? 0 },
			},
		});
	},
	(t) => t.hash
);

export const SharedView = component(() => {
	const apiService = services.get(AmuleApiService);

	const sharedList = signal<AmuleFile[]>([]);
	const selectedHash = signal<string | null>(null);
	const sortColumn = signal<keyof AmuleFile>('name');
	const sortDirection = signal<'asc' | 'desc'>('asc');

	const isDisabled = computed(() => !selectedHash.get());

	const loadShared = smartPoll(
		sharedList,
		async () => {
			const data = await apiService.getSharedFiles();
			return data.list || [];
		},
		2000
	);

	const sort = (col: keyof AmuleFile) => {
		if (sortColumn.get() === col) {
			sortDirection.set(sortDirection.get() === 'asc' ? 'desc' : 'asc');
		} else {
			sortColumn.set(col);
			sortDirection.set('asc');
		}
	};

	const executeCommand = async (cmd: 'pause' | 'resume' | 'stop' | 'cancel') => {
		const hash = selectedHash.get();
		if (!hash) return;
		try {
			if (cmd === 'cancel' && !confirm('Are you sure you want to cancel this download?')) {
				return;
			}
			await apiService.sendDownloadCommand(hash, cmd);
			if (cmd === 'cancel') selectedHash.set(null);
			loadShared();
		} catch (e: any) {
			alert(e.message);
		}
	};

	const sharedListLength = computed(() => sharedList.get().length);

	return tpl.fragment({
		refreshBtn: { onclick: loadShared },

		cancelBtn: {
			disabled: isDisabled,
			onclick: () => executeCommand('cancel'),
		},

		sharedListContainer: {
			inner: () => (sharedListLength.get() === 0 ? tpl.noSharedRow({}) : SharedRows(sharedList)),
		},
	});
});
