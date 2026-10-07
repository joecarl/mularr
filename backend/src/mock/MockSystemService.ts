import { container } from '../services/container/ServiceContainer';
import { GluetunService } from '../services/GluetunService';
import type { DiskSpace } from '../types/SystemTypes';
import { getMockWorld } from './MockWorld';
import * as F from './fixtures';

/**
 * Stand-in for SystemService in MOCK_MODE: same VPN block as the real one, fixed public IP details instead of the
 * ipify/ipinfo lookups, and a fixed disk size for the mock incoming directory instead of statfs.
 */
export class MockSystemService {
	private readonly gluetunService = container.get(GluetunService);
	private readonly world = getMockWorld();

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
		info.disks = await this.getDiskSpace();
		return info;
	}

	/**
	 * One filesystem for every directory (the mock temp dir and the category dirs are inside the incoming dir), with
	 * the free space shrinking as the mock downloads progress.
	 */
	async getDiskSpace(): Promise<DiskSpace[]> {
		return [
			{
				dirs: [
					{ role: 'incoming', path: this.world.incomingDir },
					{ role: 'temp', path: this.world.tempDir },
					...this.world.categories.filter((c) => c.id !== 0 && c.path).map((c) => ({ role: 'categories' as const, path: c.path, name: c.name })),
				],
				total: F.DISK_TOTAL_BYTES,
				free: F.DISK_TOTAL_BYTES - this.world.getDiskUsedBytes(),
			},
		];
	}
}
