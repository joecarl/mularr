import { computed } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { StatsService } from '../../services/StatsService';
import tpl from '../Sidebar.html';

export const ConnectionContainer = () => {
	const statsService = services.get(StatsService);

	// Derivado de stats.connectionState (con fallback a los campos legacy id/ed2kId/kadId/connectedServer).
	const stats = () => statsService.stats.get();
	const conn = () => stats()?.connectionState;

	const ed2kConnected = () => (conn() ? !!conn()!.ed2kConnected : !!stats()?.connectedServer);
	const ed2kConnecting = () => !ed2kConnected() && !!conn()?.ed2kConnecting;
	const kadConnected = () => (conn() ? !!conn()!.kadConnected : !!stats()?.kadId && stats()!.kadId !== '-' && stats()!.kadId !== '0');
	const kadFirewalled = () => !!conn()?.kadFirewalled;
	const kadRunning = () => (conn() ? !!conn()!.kadRunning : kadConnected());
	const kadConnecting = () => !kadConnected() && kadRunning();

	const ed2kId = () => conn()?.ed2kId ?? stats()?.ed2kId ?? stats()?.id;
	const isHighId = () => !!stats()?.isHighID;

	const serverName = () => conn()?.serverName || stats()?.connectedServer?.name;
	const serverAddress = () => {
		const v4 = conn()?.serverIpv4;
		if (v4?.address) return `${v4.address}:${v4.port}`;
		const srv = stats()?.connectedServer;
		return srv ? `${srv.ip}:${srv.port}` : '';
	};
	const serverDescription = () => conn()?.serverDescription || stats()?.connectedServer?.description;

	const connStatus = computed(() => {
		if (!stats()) return { text: 'Loading…', level: 'idle', pulse: true };
		const e = ed2kConnected();
		const k = kadConnected();
		const connecting = ed2kConnecting() || kadConnecting();
		if (e && k) return { text: 'Connected', level: 'ok', pulse: false };
		if (e || k) return { text: e ? 'ED2K only' : 'Kad only', level: 'warn', pulse: connecting };
		if (connecting) return { text: 'Connecting…', level: 'warn', pulse: true };
		return { text: 'Disconnected', level: 'error', pulse: false };
	});

	return tpl.connectionContainer({
		nodes: {
			connStatusDot: {
				classes: {
					'dot-ok': () => connStatus.get().level === 'ok',
					'dot-warn': () => connStatus.get().level === 'warn',
					'dot-error': () => connStatus.get().level === 'error',
					'dot-pulse': () => connStatus.get().pulse,
				},
			},
			connStatusText: { inner: () => connStatus.get().text },
			highIdBadge: {
				inner: () => (isHighId() ? 'High ID' : 'Low ID'),
				title: () => (isHighId() ? 'Your client is directly reachable' : 'Low ID: incoming connections blocked, check your port forwarding'),
				style: { display: () => (ed2kConnected() ? '' : 'none') },
				classes: {
					'badge-success': () => isHighId(),
					'badge-warning': () => !isHighId(),
				},
			},
			serverName: {
				inner: () => {
					if (ed2kConnected()) return serverName() || 'Unknown server';
					if (ed2kConnecting()) return 'Connecting…';
					return 'Not connected';
				},
			},
			serverIpPort: { inner: () => (ed2kConnected() || ed2kConnecting() ? serverAddress() || '-' : '-') },
			serverDesc: {
				inner: () => {
					if (ed2kConnected()) return serverDescription() || 'No description available';
					if (ed2kConnecting()) return 'Establishing connection…';
					return 'Please connect to a server';
				},
			},
			ed2kBadge: {
				title: () => {
					if (ed2kConnected()) return `ED2K ID: ${ed2kId() ?? '-'} (${isHighId() ? 'High' : 'Low'} ID)`;
					if (ed2kConnecting()) return 'Connecting to ED2K server…';
					return 'ED2K: disconnected';
				},
				classes: {
					'badge-success': () => ed2kConnected(),
					'badge-warning': () => ed2kConnecting(),
					'badge-error': () => !ed2kConnected() && !ed2kConnecting(),
				},
			},
			ed2kBadgeIcon: { inner: () => (ed2kConnected() ? '✔' : ed2kConnecting() ? '…' : '✖') },
			kadBadge: {
				title: () => {
					if (kadConnected()) return kadFirewalled() ? 'Kad: connected but firewalled, check your UDP port' : 'Kad: connected (open)';
					if (kadConnecting()) return 'Kad: connecting…';
					return 'Kad: stopped';
				},
				classes: {
					'badge-success': () => kadConnected() && !kadFirewalled(),
					'badge-warning': () => (kadConnected() && kadFirewalled()) || kadConnecting(),
					'badge-error': () => !kadConnected() && !kadConnecting(),
				},
			},
			kadBadgeIcon: { inner: () => (kadConnected() ? (kadFirewalled() ? '⚠' : '✔') : kadConnecting() ? '…' : '✖') },
		},
	});
};
