import { signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { SystemApiService, SystemInfo } from '../../services/SystemApiService';
import { smartPoll } from '../../utils/scheduling';
import tpl from '../Sidebar.html';

export const Network = () => {
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

	// Initial fetch & loop (every 5 minutes)
	return () => {
		const info = systemInfo.get();
		if (!info) return 'Loading...';

		const result: (string | Node)[] = [];

		if (info.publicIp) {
			result.push(
				tpl.infoItem({
					nodes: {
						infoIcon: { inner: '🌐' },
						infoLabel: { inner: 'Public IP' },
						infoValue: { inner: info.publicIp },
					},
				})
			);
		}

		// Location info (from IP Details or VPN fallback)
		const details = info.ipDetails || info.vpn;
		if (details && (details.city || details.country || details.region)) {
			const loc = [details.city, details.region, details.country].filter(Boolean).join(', ');
			if (loc) {
				result.push(
					tpl.infoItem({
						nodes: {
							infoIcon: { inner: '📍' },
							infoLabel: { inner: 'Location' },
							infoValue: { inner: loc },
						},
					})
				);
			}
		}

		// Organization / ISP
		if (info.ipDetails && info.ipDetails.org) {
			result.push(
				tpl.infoItem({
					nodes: {
						infoIcon: { inner: '🏢' },
						infoLabel: { inner: 'Provider' },
						infoValue: { inner: info.ipDetails.org },
					},
				})
			);
		}

		if (info.vpn) {
			const isEnabled = info.vpn.enabled;
			const status = (info.vpn.status || (isEnabled ? 'Active' : 'Disabled')).toUpperCase();

			result.push(
				tpl.vpnInfo({
					nodes: {
						vpnStatusBadge: {
							inner: status,
							classes: {
								'vpn-badge-active': isEnabled,
								'vpn-badge-inactive': !isEnabled,
							},
						},
						vpnPortContainer: {
							style: { display: isEnabled && info.vpn.port ? '' : 'none' },
						},
						vpnPortValue: { inner: String(info.vpn.port || '-') },
					},
				})
			);
		}

		return result;
	};
};
