import { componentList, computed } from 'chispa';
import { formatAmount, formatBytes, formatSpeed } from '../../utils/formats';
import { StatsService } from '../../services/StatsService';
import { services } from '../../services/container/ServiceContainer';
import tpl from '../Sidebar.html';

const formatLimit = (v: number) => (v === 0 ? { text: 'Unlimited' } : formatSpeed(v));

interface StatField {
	key: string;
	label: string;
	render: (v: any) => any;
}

interface RenderedStat {
	def: StatField;
	rendered: any;
}

const statsFields: { key: string; label: string; render: (v: any) => any }[] = [
	{ key: 'downloadOverhead', label: 'Download overhead', render: formatSpeed },
	{ key: 'uploadOverhead', label: 'Upload overhead', render: formatSpeed },
	{ key: 'bannedCount', label: 'Banned', render: formatAmount },
	{ key: 'totalSentBytes', label: 'Total sent', render: formatBytes },
	{ key: 'totalReceivedBytes', label: 'Total received', render: formatBytes },
	{ key: 'sharedFileCount', label: 'Shared files', render: formatAmount },
	{ key: 'uploadSpeedLimit', label: 'Upload limit', render: formatLimit },
	{ key: 'downloadSpeedLimit', label: 'Download limit', render: formatLimit },
	{ key: 'totalSourceCount', label: 'Sources', render: formatAmount },
	{ key: 'ed2kUsers', label: 'ED2K users', render: formatAmount },
	{ key: 'kadUsers', label: 'KAD users', render: formatAmount },
	{ key: 'ed2kFiles', label: 'ED2K files', render: formatAmount },
	{ key: 'kadFiles', label: 'KAD files', render: formatAmount },
	{ key: 'kadNodes', label: 'KAD nodes', render: formatAmount },
];

const StatsRows = componentList<RenderedStat>(
	(s) => {
		const valueText = computed(() => s.get().rendered.text);
		const unitText = computed(() => {
			const unit = s.get().rendered.unit;
			return unit ? unit : '';
		});

		return tpl.statRow({
			nodes: {
				statLabel: { inner: () => s.get().def.label + ':' },
				statValue: { inner: valueText },
				statUnit: () => (unitText.get() ? tpl.statUnit({ inner: unitText }) : null),
			},
		});
	},
	(s) => s.def.key
);

export const Stats = () => {
	const statsService = services.get(StatsService);

	const computedStats = computed(() => {
		const res: RenderedStat[] = [];
		const s = statsService.stats.get();
		if (!s) return res;

		for (const f of statsFields) {
			const val = (s as any)[f.key];
			if (val === undefined || val === null || val === '') continue;

			const rendered = f.render(val);
			if (rendered === null || rendered === undefined || rendered === '') continue;
			res.push({ def: f, rendered });
		}
		return res;
	});

	const loading = computed(() => computedStats.get().length === 0);

	return () => (loading.get() ? 'Loading...' : StatsRows(computedStats));

	// // Fallback if empty (preserve previous raw text behavior)
	// if (result.length === 0 && s.raw) {
	// 	return s.raw.split('\n').flatMap((line, i) => (i > 0 ? [tpl.statsBr({}), line] : [line]));
	// }
};
