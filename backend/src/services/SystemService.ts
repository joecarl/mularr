import axios from 'axios';
import fs from 'fs';
import { __APP_CONFIG__ } from '../app-env';
import { container } from './container/ServiceContainer';
import { GluetunService } from './GluetunService';
import { AmuledService } from './AmuledService';
import { AmuleService } from './AmuleService';
import { LoggerFactory } from './logging/Logger';
import type { DiskDir, DiskSpace } from '../types/SystemTypes';

/**
 * How long a public IP lookup is reused. The system:info broadcast in WsBroadcastService runs more
 * often than this (the disk space in it moves with the downloads), so the public IP is refreshed
 * every few broadcasts, while the WS (re)connects and REST calls in between stop hitting ipify again.
 */
const PUBLIC_IP_TTL_MS = 5 * 60 * 1000;

interface PublicIpLookup {
	ip: Promise<string | null>;
	expiresAt: number;
}

type IpDetails = Record<string, unknown>;

export class SystemService {
	private readonly logger = LoggerFactory.create(this);
	private readonly gluetunService = container.get(GluetunService);
	private readonly amuledService = container.get(AmuledService);
	private readonly amuleService = container.get(AmuleService);
	private publicIpLookup: PublicIpLookup | null = null;
	/** ipinfo details keyed by IP. They never change for a given IP, and the map only grows when the public IP does. */
	private readonly ipDetailsLookups = new Map<string, Promise<IpDetails | null>>();

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

		// Public IP Info (third-party lookups, cached: see getPublicIp / getIpInfo)

		// if (this.gluetunService.isEnabled) {
		// 	publicIp = await this.gluetunService.getPublicIp();
		// 	console.log('Gluetun Public IP:', publicIp);
		// }

		const publicIp = await this.getPublicIp();
		info.publicIp = publicIp;

		// Expanded IP Info (if we have an IP)
		if (publicIp) {
			const ipDetails = await this.getIpInfo(publicIp);
			if (ipDetails) {
				info.ipDetails = ipDetails;
			}
		}

		info.disks = await this.getDiskSpace();

		return info;
	}

	/**
	 * Free space of the filesystems behind the download directories (incoming, temp and the categories with a
	 * path of their own), as statfs reports it for each directory: inside Docker that is the host volume mounted
	 * there. Directories on the same filesystem (same device) give a single entry. A directory that cannot be
	 * stat'ed (not created yet, volume not mounted) is left out rather than failing the whole system info.
	 */
	public async getDiskSpace(): Promise<DiskSpace[]> {
		const dirs = await this.getDownloadDirs();
		const disks: DiskSpace[] = [];
		const byDevice = new Map<bigint, DiskSpace>();
		for (const dir of dirs) {
			try {
				const [stat, statfs] = await Promise.all([fs.promises.stat(dir.path, { bigint: true }), fs.promises.statfs(dir.path, { bigint: true })]);
				let disk = byDevice.get(stat.dev);
				if (!disk) {
					disk = { dirs: [], total: Number(statfs.blocks * statfs.bsize), free: Number(statfs.bavail * statfs.bsize) };
					byDevice.set(stat.dev, disk);
					disks.push(disk);
				}
				disk.dirs.push(dir);
			} catch (e) {
				this.logger.debug(`Cannot read disk space of ${dir.role} dir ${dir.path}:`, (e as Error).message);
			}
		}
		return disks;
	}

	/**
	 * Directories the downloads can land in, in display order: incoming and temp (environment override first, then
	 * amule.conf), then every aMule category with a path of its own (an empty path means the incoming dir). Unset or
	 * unreadable ones are skipped; the categories are only asked for while the daemon runs, as they come from the EC.
	 */
	private async getDownloadDirs(): Promise<DiskDir[]> {
		let config: { incomingDir?: string; tempDir?: string } = {};
		try {
			config = await this.amuledService.getConfig();
		} catch (e) {
			this.logger.debug('Cannot read amule config for disk space:', (e as Error).message);
		}
		const dirs: DiskDir[] = [];
		const incomingDir = __APP_CONFIG__.amule.incomingDir ?? config.incomingDir;
		const tempDir = __APP_CONFIG__.amule.tempDir ?? config.tempDir;
		if (incomingDir) dirs.push({ role: 'incoming', path: incomingDir });
		if (tempDir) dirs.push({ role: 'temp', path: tempDir });
		if (await this.amuledService.isDaemonRunning()) {
			for (const category of await this.amuleService.getCategories()) {
				// The default category (id 0) is the incoming dir itself: the EC reports it with an empty path only while no other
				// category exists, and with the incoming dir as its path as soon as one is defined
				if (category.id !== 0 && category.path) dirs.push({ role: 'categories', path: category.path, name: category.name });
			}
		}
		return dirs;
	}

	/** Cached for PUBLIC_IP_TTL_MS; concurrent callers share one in-flight request. A failed lookup is not cached. */
	private getPublicIp(): Promise<string | null> {
		if (!this.publicIpLookup || this.publicIpLookup.expiresAt <= Date.now()) {
			const lookup: PublicIpLookup = { ip: this.fetchPublicIp(), expiresAt: Date.now() + PUBLIC_IP_TTL_MS };
			lookup.ip.then((ip) => {
				if (ip === null && this.publicIpLookup === lookup) this.publicIpLookup = null;
			});
			this.publicIpLookup = lookup;
		}
		return this.publicIpLookup.ip;
	}

	private async fetchPublicIp(): Promise<string | null> {
		try {
			const res = await axios.get('https://api.ipify.org?format=json', { timeout: 2000 });
			return typeof res.data?.ip === 'string' ? res.data.ip : null;
		} catch (e) {
			// ignore network errors
			return null;
		}
	}

	/** Cached per IP; concurrent callers share one in-flight request. A failed lookup is not cached. */
	private getIpInfo(ip: string): Promise<IpDetails | null> {
		let lookup = this.ipDetailsLookups.get(ip);
		if (!lookup) {
			lookup = this.fetchIpInfo(ip).then((details) => {
				if (details === null) this.ipDetailsLookups.delete(ip);
				return details;
			});
			this.ipDetailsLookups.set(ip, lookup);
		}
		return lookup;
	}

	private async fetchIpInfo(ip: string): Promise<IpDetails | null> {
		try {
			// NOTE: ipinfo.io has rate limits for unauthenticated requests, hence the per-IP cache above.
			const res = await axios.get(`https://ipinfo.io/${ip}/json`, { timeout: 3000 });
			return res.data ?? null;
		} catch (error) {
			// ignore enrichment errors
			return null;
		}
	}
}
