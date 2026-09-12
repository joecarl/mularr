import { container } from '../services/container/ServiceContainer';
import { GluetunService } from '../services/GluetunService';
import * as F from './fixtures';

/** Stand-in for SystemService in MOCK_MODE: same VPN block as the real one, fixed public IP details instead of the ipify/ipinfo lookups. */
export class MockSystemService {
	private readonly gluetunService = container.get(GluetunService);

	async getSystemInfo(): Promise<any> {
		const info: any = {};
		if (this.gluetunService.isEnabled) {
			const vpnStatus = await this.gluetunService.getVpnStatus();
			info.vpn = vpnStatus ? { enabled: true, status: vpnStatus.status, ...vpnStatus } : { enabled: true, status: 'error' };
			const port = await this.gluetunService.getPortForwarded();
			if (port) info.vpn.port = port;
		} else {
			info.vpn = { enabled: false };
		}
		info.publicIp = F.PUBLIC_IP;
		info.ipDetails = { ...F.IP_DETAILS };
		return info;
	}
}
