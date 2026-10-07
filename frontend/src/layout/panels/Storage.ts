import { inject, componentList, computed } from 'chispa';
import type { DiskRole, DiskSpace } from '../../services/SystemApiService';
import { WsService } from '../../services/WsService';
import { fbytes } from '../../utils/formats';
import tpl from '../Sidebar.html';

/** Used share above which the bar turns orange, then red. */
const WARN_USED_PCT = 85;
const CRIT_USED_PCT = 95;

/** Short labels for the card header (uppercased by CSS); the directories themselves go in the card's tooltip. */
const ROLE_LABELS: Record<DiskRole, string> = {
	incoming: 'Inc',
	temp: 'Temp',
	categories: 'Cat',
};

const ROLE_NAMES: Record<DiskRole, string> = {
	incoming: 'Incoming',
	temp: 'Temp',
	categories: 'Category',
};

const usedPct = (d: DiskSpace) => (d.total > 0 ? Math.min(100, Math.max(0, ((d.total - d.free) / d.total) * 100)) : 0);

/** Roles present on a disk, in the order its directories come. */
const diskRoles = (d: DiskSpace): DiskRole[] => [...new Set(d.dirs.map((dir) => dir.role))];

/** Tooltip of a disk card: every directory on it with its path, then the figures the card rounds. */
function diskTitle(d: DiskSpace): string {
	const lines = d.dirs.map((dir) => `${dir.name ?? ROLE_NAMES[dir.role]}: ${dir.path}`);
	lines.push(`${fbytes(d.total - d.free)} used of ${fbytes(d.total)}`);
	return lines.join('\n');
}

const DiskItems = componentList<DiskSpace>(
	(d) => {
		const pct = computed(() => usedPct(d.get()));
		return tpl.diskItem({
			title: () => diskTitle(d.get()),
			nodes: {
				diskRoles: {
					inner: () =>
						diskRoles(d.get())
							.map((r) => ROLE_LABELS[r])
							.join(' + '),
				},
				diskUsedPct: { inner: () => `${pct.get().toFixed(1)}% used` },
				diskBarFill: {
					style: { width: () => `${pct.get()}%` },
					classes: {
						'disk-bar-warn': () => pct.get() >= WARN_USED_PCT && pct.get() < CRIT_USED_PCT,
						'disk-bar-crit': () => pct.get() >= CRIT_USED_PCT,
					},
				},
				diskFree: { inner: () => fbytes(d.get().free) },
				diskTotal: { inner: () => fbytes(d.get().total) },
			},
		});
	},
	(d) => d.dirs[0].path
);

/**
 * Free space of the filesystems behind the download directories, from the system:info broadcast; the top of the
 * "Storage & Status" sidebar box (see Stats.ts). Hidden until the first broadcast arrives, and when no directory could be read.
 */
export const DiskCards = () => {
	const ws = inject(WsService);
	const disks = computed<DiskSpace[]>(() => ws.systemInfo.get()?.disks ?? []);

	return tpl.disksContainer({
		style: { display: () => (disks.get().length ? '' : 'none') },
		nodes: {
			diskItem: DiskItems(disks),
		},
	});
};
