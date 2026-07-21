import { component, componentList, computed, Signal } from 'chispa';
import { Transfer } from '../../services/MediaApiService';
import { getProviderIcon, getProviderName } from '../../services/ProvidersApiService';
import { getFileIcon } from '../../utils/icons';
import { fbytes, formatRemaining } from '../../utils/formats';
import { TransferProgressBar } from './TransferProgressBar';
import { formatSourcesSummary } from './sourcesSummary';
import { statusMap } from './transferStatus';
import tpl from './TransferDetailsDialog.html';
import './TransfersView.css';

export interface TransferDetailsDialogProps {
	transfer: Signal<Transfer>;
	onClose: () => void;
}

function formatPeerSourceFrom(sourceFrom?: number): string {
	if (sourceFrom === undefined || sourceFrom === null) return '-';
	const labels: Record<number, string> = {
		1: 'Server',
		2: 'Kad',
		3: 'Source exchange',
		4: 'Passive',
		5: 'Link',
	};
	return labels[sourceFrom] || `Code ${sourceFrom}`;
}

const PeerRows = componentList<NonNullable<Transfer['sources']>[number]>(
	(peer) => {
		const p = () => peer.get();
		const endpoint = () => {
			const ip = p().ip || '-';
			const port = p().port;
			return port ? `${ip}:${port}` : ip;
		};
		const speed = () => {
			const down = p().downloadSpeed || 0;
			if (down <= 0) return '-';
			return `${fbytes(down)}/s`;
		};
		const queue = () => {
			const rank = p().remoteQueueRank;
			if (rank && rank > 0) return `#${rank}`;
			const waiting = p().waitingPosition;
			if (waiting && waiting > 0) return `W ${waiting}`;
			return '-';
		};

		return tpl.peerRow({
			nodes: {
				peerName: { inner: () => p().clientName || 'Unknown' },
				peerSoftware: { inner: () => [p().software, p().softwareVersion].filter(Boolean).join(' ') || '-' },
				peerEndpoint: { inner: endpoint },
				peerSpeed: { inner: speed },
				peerAvail: { inner: () => (p().availableParts !== undefined ? String(p().availableParts) : '-') },
				peerFrom: { inner: () => formatPeerSourceFrom(p().sourceFrom) },
				peerQueue: { inner: queue },
			},
		});
	},
	(peer) => `${peer.ip || 'ip'}:${peer.port || 0}-${peer.clientName || 'client'}-${peer.remoteFilename || 'file'}`
);

const SourceNameRows = componentList<NonNullable<Transfer['sourceNames']>[number]>(
	(sourceName) => {
		const s = () => sourceName.get();
		return tpl.sourceNameRow({
			nodes: {
				sourceNameName: { inner: () => s().name || '-' },
				sourceNameCount: { inner: () => String(s().count ?? 0) },
			},
		});
	},
	(sourceName) => `${sourceName.name || 'source'}-${sourceName.count || 0}`
);

export const TransferDetailsDialog = component<TransferDetailsDialogProps>(({ transfer: t, onClose }) => {
	const statusText = computed(() =>
		t.get().stopped ? 'Stopped' : t.get().isCompleted ? 'Completed' : statusMap[t.get().statusId ?? -1] || t.get().status || 'Unknown'
	);
	const addedOnText = computed(() => {
		const addedOn = t.get().addedOn;
		return addedOn ? new Date(addedOn).toLocaleString() : '-';
	});
	const ed2kLink = computed(() => t.get().link || t.get().fileEd2kLink || '');
	const hasLink = computed(() => !!ed2kLink.get());
	const sourceNames = computed(() => {
		const names = t.get().sourceNames || [];
		if (names.length === 0) return [];
		return [...names].sort((a, b) => (b.count || 0) - (a.count || 0));
	});
	const peers = computed(() => {
		const raw = t.get().sources || [];
		if (raw.length === 0) return [];
		return [...raw].sort((a, b) => (b.downloadSpeed || 0) - (a.downloadSpeed || 0));
	});
	const hasPeers = computed(() => peers.get().length > 0);
	const hasSourceNames = computed(() => sourceNames.get().length > 0);

	const categoryLabel = computed(() => {
		const categoryName = t.get().categoryName;
		return categoryName && categoryName !== 'default' ? categoryName : 'Default';
	});

	return tpl.fragment({
		fileIcon: { inner: () => getFileIcon(t.get().name || '') },
		valName: { inner: () => t.get().name || '-' },
		valHash: { inner: () => t.get().hash || '-' },
		valProviderIcon: { inner: () => getProviderIcon(t.get().provider) },
		valProviderName: { inner: () => ' ' + getProviderName(t.get().provider) },
		valStatus: { inner: statusText },
		valSize: { inner: () => fbytes(t.get().size) },
		valCompleted: { inner: () => fbytes(t.get().completed) },
		valSpeed: { inner: () => ((t.get().speed ?? 0) > 0 ? fbytes(t.get().speed) + '/s' : '-') },
		valRemaining: { inner: () => formatRemaining(t.get().remaining, t.get().speed) },
		valSources: { inner: () => formatSourcesSummary(t.get()) },
		valPriority: { inner: () => String(t.get().priority ?? 0) },
		valCategory: { inner: categoryLabel },
		valSourceInfo: { inner: () => t.get().sourceName || '-' },
		valAddedOn: { inner: addedOnText },
		filePathRow: {
			style: { display: () => (t.get().filePath ? '' : 'none') },
		},
		valFilePath: { inner: () => t.get().filePath || '' },
		progressMount: TransferProgressBar({
			transfer: t,
			preferChunked: true,
		}),

		peerSection: {
			style: { display: () => (hasPeers.get() ? '' : 'none') },
		},
		peerCount: { inner: () => String(peers.get().length) },
		peerRows: {
			inner: () => PeerRows(peers),
		},
		sourceNamesSection: {
			style: { display: () => (hasSourceNames.get() ? '' : 'none') },
		},
		sourceNamesCount: { inner: () => String(sourceNames.get().length) },
		sourceNamesRows: {
			inner: () => SourceNameRows(sourceNames),
		},

		ed2kSection: {
			style: { display: () => (hasLink.get() ? '' : 'none') },
		},
		valEd2kLink: { inner: ed2kLink },
		copyLinkBtn: {
			onclick: () => navigator.clipboard.writeText(ed2kLink.get()),
		},
		btnClose: { onclick: onClose },
	});
});
