import { component, componentList, computed, Signal, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { SystemApiService, SystemInfo } from '../../services/SystemApiService';
import { smartPoll } from '../../utils/scheduling';
import tpl from '../Sidebar.html';

interface InfoItemProps {
	icon: string;
	label: string;
	value: string;
}

interface NetworkProps {
	systemInfo: Signal<SystemInfo | null>;
}
const Net = component<NetworkProps>(({ systemInfo }) => {
	const infoItemsData = computed<InfoItemProps[]>(() => {
		const result: InfoItemProps[] = [];
		const info = systemInfo.get();
		if (!info) return result;

		if (info.publicIp) {
			result.push({ icon: '🌐', label: 'Public IP', value: info.publicIp });
		}

		// Location info (from IP Details or VPN fallback)
		const details = info.ipDetails || info.vpn;
		if (details && (details.city || details.country || details.region)) {
			const loc = [details.city, details.region, details.country].filter(Boolean).join(', ');
			if (loc) {
				result.push({ icon: '📍', label: 'Location', value: loc });
			}
		}

		// Organization / ISP
		if (info.ipDetails && info.ipDetails.org) {
			result.push({ icon: '🏢', label: 'Provider', value: info.ipDetails.org });
		}
		return result;
	});

	const InfoItems = componentList<InfoItemProps>(
		(i) => {
			return tpl.infoItem({
				nodes: {
					infoIcon: { inner: () => i.get().icon },
					infoLabel: { inner: () => i.get().label },
					infoValue: { inner: () => i.get().value },
				},
			});
		},
		(i) => i.label
	);

	const vpn = computed(() => systemInfo.get()?.vpn!);
	const isEnabled = computed(() => systemInfo.get()?.vpn?.enabled ?? false);

	const VpnInfo = () => {
		return tpl.vpnInfo({
			nodes: {
				vpnStatusBadge: {
					inner: () => {
						return (vpn.get().status || (vpn.get().enabled ? 'Active' : 'Disabled')).toUpperCase();
					},
					classes: {
						'vpn-badge-active': isEnabled,
						'vpn-badge-inactive': () => !isEnabled.get(),
					},
				},
				vpnPortContainer: {
					style: { display: () => (isEnabled.get() && vpn.get().port ? '' : 'none') },
				},
				vpnPortValue: { inner: () => String(vpn.get().port || '-') },
			},
		});
	};

	const vpnPresent = computed(() => !!systemInfo.get()?.vpn);

	return tpl.networkContainer({
		nodes: {
			infoItem: InfoItems(infoItemsData),
			vpnInfo: () => (vpnPresent.get() ? VpnInfo() : null),
		},
	});
});

export const NetworkContainer = () => {
	const systemApiService = services.get(SystemApiService);
	const systemInfo = signal<SystemInfo | null>(null);

	smartPoll(async () => {
		try {
			const info = await systemApiService.getSystemInfo();
			systemInfo.set(info);
		} catch (e) {
			console.error(e);
		}
	}, 60000 * 5);

	const infoAvailable = computed(() => !!systemInfo.get());

	// Initial fetch & loop (every 5 minutes)
	return () => {
		const info = infoAvailable.get();
		if (!info) return tpl.networkContainer({ inner: 'Loading...' });
		return Net({ systemInfo });
	};
};
