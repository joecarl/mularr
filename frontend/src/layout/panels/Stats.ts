import { inject, componentList, computed, signal } from 'chispa';
import { formatAmount, formatBytes, formatSpeed } from '../../utils/formats';
import { StatsService } from '../../services/StatsService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { DiskCards } from './Storage';
import tpl from '../Sidebar.html';

const formatLimit = (v: number) => (v === 0 ? { text: 'Unlimited' } : formatSpeed(v));

interface StatField {
	key: string;
	label: string;
	render: (v: any) => any;
	/** Shown only once the panel is expanded with the "Show more" button. */
	extra?: boolean;
}

interface RenderedStat {
	def: StatField;
	rendered: any;
}

/** Local preference remembering whether the extra rows are expanded. */
const EXPANDED_PREF_KEY = 'sidebar.stats.expanded';

const statsFields: StatField[] = [
	{ key: 'totalSentBytes', label: 'Total sent', render: formatBytes },
	{ key: 'totalReceivedBytes', label: 'Total received', render: formatBytes },
	{ key: 'sharedFileCount', label: 'Shared files', render: formatAmount },
	{ key: 'uploadSpeedLimit', label: 'Upload limit', render: formatLimit },
	{ key: 'downloadSpeedLimit', label: 'Download limit', render: formatLimit },
	{ key: 'downloadOverhead', label: 'Download overhead', render: formatSpeed, extra: true },
	{ key: 'uploadOverhead', label: 'Upload overhead', render: formatSpeed, extra: true },
	{ key: 'bannedCount', label: 'Banned', render: formatAmount, extra: true },
	{ key: 'totalSourceCount', label: 'Sources', render: formatAmount, extra: true },
	{ key: 'ed2kUsers', label: 'ED2K users', render: formatAmount, extra: true },
	{ key: 'kadUsers', label: 'KAD users', render: formatAmount, extra: true },
	{ key: 'ed2kFiles', label: 'ED2K files', render: formatAmount, extra: true },
	{ key: 'kadFiles', label: 'KAD files', render: formatAmount, extra: true },
	{ key: 'kadNodes', label: 'KAD nodes', render: formatAmount, extra: true },
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

export const StatsContainer = () => {
	const statsService = inject(StatsService);
	const prefs = inject(LocalPrefsService);
	const expanded = signal(prefs.get(EXPANDED_PREF_KEY, false));

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

	const hasExtra = computed(() => computedStats.get().some((s) => s.def.extra));
	const visibleStats = computed(() => (expanded.get() ? computedStats.get() : computedStats.get().filter((s) => !s.def.extra)));
	const loading = computed(() => computedStats.get().length === 0);

	return tpl.statsBox({
		nodes: {
			disksContainer: DiskCards(),
			statsContainer: {
				inner: () => (loading.get() ? 'Loading...' : StatsRows(visibleStats)),
			},
			statsToggle: {
				inner: () => (expanded.get() ? 'Show less ▴' : 'Show more ▾'),
				style: { display: () => (hasExtra.get() ? '' : 'none') },
				onclick: () => {
					expanded.set(!expanded.get());
					prefs.set(EXPANDED_PREF_KEY, expanded.get());
				},
			},
		},
	});
};
