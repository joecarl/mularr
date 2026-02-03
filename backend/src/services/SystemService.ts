import axios from 'axios';
import { container } from '../ServiceContainer';
import { GluetunService } from './GluetunService';

export class SystemService {
	private gluetunService = container.get(GluetunService);

	public async getSystemInfo(): Promise<any> {
		const info: any = {};

		// VPN Info
		if (this.gluetunService.isEnabled) {
			const vpnStatus = await this.gluetunService.getVpnStatus();
			if (vpnStatus) {
				info.vpn = {
					enabled: true,
					status: vpnStatus.status,
					...vpnStatus,
				};
			} else {
				info.vpn = { enabled: true, status: 'error' };
			}

			// Port Forwarding Info
			const port = await this.gluetunService.getPortForwarded();
			if (port) {
				info.vpn.port = port;
			}
		} else {
			info.vpn = { enabled: false };
		}

		// Public IP Info
		let publicIp: string | null = null;

		// if (this.gluetunService.isEnabled) {
		// 	publicIp = await this.gluetunService.getPublicIp();
		// 	console.log('Gluetun Public IP:', publicIp);
		// }

		// Fallback for Public IP if gluetun didn't provide it
		if (!publicIp) {
			try {
				const ipRes = await axios.get('https://api.ipify.org?format=json', { timeout: 2000 });
				publicIp = ipRes.data.ip;
			} catch (e) {
				// ignore network errors
			}
		}

		info.publicIp = publicIp;

		// Expanded IP Info (if we have an IP)
		if (publicIp) {
			try {
				// We don't want to block the main request too long for enrichment,
				// but for simplicity we await it here.
				// NOTE: ipinfo.io has rate limits for unauthenticated requests.
				const ipDetails = await this.getIpInfo(publicIp);
				if (ipDetails) {
					info.ipDetails = ipDetails;
				}
			} catch (e) {
				// ignore enrichment errors
			}
		}

		return info;
	}

	private async getIpInfo(ip: string): Promise<any> {
		try {
			// Using ipinfo.io as requested.
			// Note: In a real app, you might want to cache this response to avoid hitting rate limits.
			const res = await axios.get(`https://ipinfo.io/${ip}/json`, { timeout: 3000 });
			return res.data;
		} catch (error) {
			// console.warn('Failed to fetch IP details');
			return null;
		}
	}
}
