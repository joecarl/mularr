import axios from 'axios';
import { container } from './container/ServiceContainer';
import { AmuledService } from './AmuledService';

export class GluetunService {
	private readonly apiBase: string;
	private readonly checkInterval: number = 60 * 1000; // 1 minute
	private intervalId: NodeJS.Timeout | null = null;
	private readonly amuledService = container.get(AmuledService);

	constructor() {
		// Remove trailing slash if present
		this.apiBase = (process.env.GLUETUN_API || 'http://localhost:8000/v1').replace(/\/$/, '');
	}

	public get isEnabled(): boolean {
		return process.env.GLUETUN_ENABLED?.toLowerCase() === 'true';
	}

	public start() {
		if (!this.isEnabled) {
			return;
		}

		console.log('Starting Gluetun monitoring service...');
		this.checkAndApply();
		this.intervalId = setInterval(() => this.checkAndApply(), this.checkInterval);
	}

	public stop() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private async checkAndApply() {
		try {
			// Check /vpn/status
			const statusUrl = `${this.apiBase}/vpn/status`;
			const statusRes = await axios.get(statusUrl); // Throws if status outside 2xx

			// Even though axios throws on non-2xx by default, we can check explicitly if we configured validation otherwise.
			// But sticking to defaults, it will throw.
			// The requirement says "tiene que devolver un codigo 200".

			if (statusRes.status !== 200) {
				console.warn(`Gluetun status check returned ${statusRes.status}`);
				return;
			}

			// Get /portforward
			const portUrl = `${this.apiBase}/portforward`;
			const portRes = await axios.get(portUrl);
			const port = portRes.data?.port;

			if (port && typeof port === 'number') {
				const changed = await this.amuledService.updateCoreConfig(port);
				if (changed) {
					console.log(`Gluetun port changed to ${port}. Restarting aMule daemon...`);
					await this.amuledService.restartDaemon();
				}
			} else {
				// Only warn if we really expected a port but got garbage?
				if (portRes.data && !portRes.data.port) {
					console.warn('Gluetun response missing port:', portRes.data);
				}
			}
		} catch (error: any) {
			console.error('Gluetun Service Error:', error.message);
		}
	}

	public async getPublicIp(): Promise<string | null> {
		try {
			const res = await axios.get(`${this.apiBase}/publicip/ip`);
			return res.data?.public_ip || res.data?.ip || (typeof res.data === 'string' ? res.data : null);
		} catch (error) {
			// console.error('Error fetching public IP from Gluetun:', error);
			return null;
		}
	}

	public async getVpnStatus(): Promise<any> {
		try {
			const res = await axios.get(`${this.apiBase}/vpn/status`);
			return res.data;
		} catch (error) {
			// console.error('Error fetching VPN status from Gluetun:', error);
			return null;
		}
	}

	public async getPortForwarded(): Promise<number | null> {
		try {
			const res = await axios.get(`${this.apiBase}/portforward`);
			return res.data?.port || null;
		} catch (error) {
			return null;
		}
	}
}
