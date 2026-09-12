import * as F from './fixtures';

/** Stand-in for GluetunService in MOCK_MODE: a healthy VPN with a forwarded port, whatever the environment says. */
export class MockGluetunService {
	get isEnabled(): boolean {
		return true;
	}

	async getPublicIp(): Promise<string | null> {
		return F.PUBLIC_IP;
	}

	async getVpnStatus(): Promise<any> {
		return { status: 'running' };
	}

	async getPortForwarded(): Promise<number | null> {
		return F.VPN_FORWARDED_PORT;
	}
}
