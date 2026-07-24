import axios from 'axios';

export class GluetunService {
	private readonly apiBase: string;

	constructor() {
		// Remove trailing slash if present
		this.apiBase = (process.env.GLUETUN_API || 'http://localhost:8000/v1').replace(/\/$/, '');
	}

	public get isEnabled(): boolean {
		return process.env.GLUETUN_ENABLED?.toLowerCase() === 'true';
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
			const res = await axios.get(`${this.apiBase}/portforward`, { timeout: 5000 });

			// If GLUETUN_PORT_INDEX is defined with a valid integer, pick that index from the ports array
			const portIndexRaw = process.env.GLUETUN_PORT_INDEX;
			if (portIndexRaw !== undefined && portIndexRaw !== '') {
				const portIndex = parseInt(portIndexRaw, 10);
				if (!isNaN(portIndex)) {
					const ports = res.data?.ports;
					if (Array.isArray(ports) && ports[portIndex] != null) {
						return ports[portIndex];
					}
					return null;
				}
			}

			// Default behavior: use the single forwarded port
			return res.data?.port || null;
		} catch (error) {
			return null;
		}
	}
}
