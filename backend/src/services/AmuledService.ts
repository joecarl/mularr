import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import net from 'net';

const execPromise = util.promisify(exec);

export class AmuledService {
	private readonly configDir = process.env.AMULE_CONFIG_DIR || path.join(process.env.HOME || '/home/node', '.aMule');
	private _isRestarting = false;

	get isRestarting(): boolean {
		return this._isRestarting;
	}

	async updateCoreConfig(port: number): Promise<boolean> {
		try {
			const confPath = path.join(this.configDir, 'amule.conf');

			if (!fs.existsSync(confPath)) {
				console.error('amule.conf not found at', confPath);
				return false;
			}

			let content = fs.readFileSync(confPath, 'utf-8');
			let changed = false;

			// Update TCP Port
			if (content.match(new RegExp(`^Port=${port}$`, 'm'))) {
				// already set
			} else {
				// Replace Port=...
				const newContent = content.replace(/^Port=\d+$/m, `Port=${port}`);
				if (newContent !== content) {
					content = newContent;
					changed = true;
				} else {
					// Maybe it wasn't there, append or ignore?
					// Usually it is there if generated.
				}
			}

			// Update UDP Port (usually same as TCP or TCP+3, but let's set same for now or follow request)
			// User asked "returns {port: xxx}". Usually VPN port forwarding gives one port for both TCP/UDP or just TCP.
			// Let's assume we use the same port for both as is common in VPN setups for eMule forward.
			if (content.match(new RegExp(`^UDPPort=${port}$`, 'm'))) {
				// already set
			} else {
				const newContent = content.replace(/^UDPPort=\d+$/m, `UDPPort=${port}`);
				if (newContent !== content) {
					content = newContent;
					changed = true;
				}
			}

			if (changed) {
				console.log(`Updating amule.conf ports to ${port}`);
				fs.writeFileSync(confPath, content, 'utf-8');
				return true;
			}
		} catch (e) {
			console.error('Error updating amule.conf:', e);
		}
		return false;
	}

	async restartDaemon(): Promise<void> {
		if (this._isRestarting) {
			console.warn('Restart already in progress, skipping duplicate request.');
			return;
		}
		this._isRestarting = true;
		console.log('Restarting aMule daemon...');
		try {
			// Graceful shutdown first
			try {
				await execPromise('pkill -TERM amuled');
			} catch (e) {
				// Not running — nothing to kill
			}

			// Poll until the process is confirmed dead (up to 8 s)
			const killed = await this.waitForProcessDead(8000);
			if (!killed) {
				console.warn('amuled did not stop gracefully, sending SIGKILL...');
				try {
					await execPromise('pkill -KILL amuled');
				} catch (e) {
					// Ignore
				}
				// Give the kernel a moment to reap it
				await new Promise((resolve) => setTimeout(resolve, 500));
			}

			await this.startDaemon();
		} catch (e) {
			console.error('Failed to restart amuled:', e);
		} finally {
			this._isRestarting = false;
		}
	}

	private async waitForProcessDead(timeoutMs: number): Promise<boolean> {
		const interval = 300;
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (!this.isDaemonRunning()) return true; // Process is dead
			await new Promise((resolve) => setTimeout(resolve, interval));
		}
		return false;
	}

	private waitForEcPort(timeoutMs: number): Promise<boolean> {
		const ecPort = parseInt(process.env.AMULE_PORT || '4712');
		const ecHost = process.env.AMULE_HOST || 'localhost';
		const interval = 400;
		const deadline = Date.now() + timeoutMs;

		const probe = (): Promise<boolean> => {
			if (Date.now() >= deadline) return Promise.resolve(false);
			return new Promise((resolve) => {
				const sock = new net.Socket();
				const onFail = () => {
					sock.destroy();
					setTimeout(() => probe().then(resolve), interval);
				};
				sock.once('connect', () => {
					sock.destroy();
					resolve(true);
				});
				sock.once('error', onFail);
				sock.once('timeout', onFail);
				sock.setTimeout(500);
				sock.connect(ecPort, ecHost);
			});
		};

		return probe();
	}

	async startDaemon(): Promise<void> {
		const running = await this.isDaemonRunning();
		if (running) {
			console.log('aMule daemon already running, skipping start.');
			return;
		}
		// Remove stale lock files that prevent amuled from starting after a hard kill
		for (const lockFile of ['amuled.lock', 'amuled.pid', '.lock']) {
			try {
				fs.rmSync(path.join(this.configDir, lockFile));
				console.log(`Removed stale lock file: ${lockFile}`);
			} catch {
				// File didn't exist — ignore
			}
		}
		console.log('Starting aMule daemon...');
		const child = spawn('amuled', ['-c', this.configDir, '-f'], {
			detached: true,
			stdio: 'ignore',
		});
		child.unref();
		const started = await this.waitForEcPort(30000);
		if (started) {
			console.log('aMule daemon started successfully.');
		} else {
			console.error('aMule daemon may not have started — EC port not reachable after 30 s.');
		}
	}

	async isDaemonRunning(): Promise<boolean> {
		try {
			await execPromise('pgrep amuled');
			return true;
		} catch (e) {
			return false;
		}
	}

	async getLog(lines: number = 50): Promise<string[]> {
		const logPath = path.join(this.configDir, 'logfile');
		try {
			if (!fs.existsSync(logPath)) {
				return ['Log file not found: ' + logPath];
			}
			const content = await fs.promises.readFile(logPath, 'utf-8');
			const allLines = content.split('\n');
			// Filter out empty lines if necessary, or just return trailing lines
			return allLines.slice(-lines);
		} catch (error) {
			console.error('Error reading log file:', error);
			return ['Error reading log file'];
		}
	}

	async getConfig() {
		const config: any = {
			lockedFields: {
				incomingDir: !!process.env.AMULE_INCOMING_DIR,
				tempDir: !!process.env.AMULE_TEMP_DIR,
				ports: process.env.GLUETUN_ENABLED?.toLowerCase() === 'true',
			},
		};

		try {
			const confPath = path.join(this.configDir, 'amule.conf');
			if (fs.existsSync(confPath)) {
				const content = fs.readFileSync(confPath, 'utf-8');
				const lines = content.split('\n');
				const findVal = (key: string) =>
					lines
						.find((l) => l.startsWith(key + '='))
						?.split('=')[1]
						?.trim();

				config.nick = findVal('Nick');
				config.tcpPort = findVal('Port');
				config.udpPort = findVal('UDPPort');
				config.maxSources = findVal('MaxSourcesPerFile');
				config.maxConnections = findVal('MaxConnections');
				config.maxConnectionsPerFiveSeconds = findVal('MaxConnectionsPerFiveSeconds');
				config.slotAllocation = findVal('SlotAllocation');
				config.queueSizePref = findVal('QueueSizePref');
				config.fileBufferSizePref = findVal('FileBufferSizePref');
				config.downloadCap = findVal('DownloadCapacity');
				config.uploadCap = findVal('UploadCapacity');
				config.incomingDir = findVal('IncomingDir');
				config.tempDir = findVal('TempDir');
				config.maxUpload = findVal('MaxUpload');
				config.maxDownload = findVal('MaxDownload');
				config.ed2k = findVal('ConnectToED2K') === '1';
				config.kad = findVal('ConnectToKad') === '1';
				config.autoconnect = findVal('Autoconnect') === '1';
				config.reconnect = findVal('Reconnect') === '1';
				config.upnp = findVal('UPnPEnabled') === '1';
				config.obfuscationRequested = findVal('IsCryptLayerRequested') === '1';
				config.obfuscationRequired = findVal('IsClientCryptLayerRequired') === '1';
				config.smartIdCheck = findVal('SmartIdCheck') === '1';
				config.ich = findVal('ICH') === '1';
				config.allocateFullFile = findVal('AllocateFullFile') === '1';
			}
		} catch (e) {
			console.warn('Could not read local amule.conf:', e);
		}

		return config;
	}

	async updateConfig(newConfig: any): Promise<void> {
		const confPath = path.join(this.configDir, 'amule.conf');
		if (!fs.existsSync(confPath)) {
			throw new Error('amule.conf not found');
		}

		let content = fs.readFileSync(confPath, 'utf-8');

		const fromBool = (val: boolean | undefined) => (val !== undefined ? (val ? '1' : '0') : undefined);

		const replacements: { [key: string]: string | undefined } = {
			Nick: newConfig.nick,
			MaxSourcesPerFile: newConfig.maxSources,
			MaxConnections: newConfig.maxConnections,
			MaxConnectionsPerFiveSeconds: newConfig.maxConnectionsPerFiveSeconds,
			SlotAllocation: newConfig.slotAllocation,
			QueueSizePref: newConfig.queueSizePref,
			FileBufferSizePref: newConfig.fileBufferSizePref,
			DownloadCapacity: newConfig.downloadCap,
			UploadCapacity: newConfig.uploadCap,
			MaxUpload: newConfig.maxUpload,
			MaxDownload: newConfig.maxDownload,
			ConnectToED2K: fromBool(newConfig.ed2k),
			ConnectToKad: fromBool(newConfig.kad),
			Autoconnect: fromBool(newConfig.autoconnect),
			Reconnect: fromBool(newConfig.reconnect),
			UPnPEnabled: fromBool(newConfig.upnp),
			IsCryptLayerRequested: fromBool(newConfig.obfuscationRequested),
			IsClientCryptLayerRequired: fromBool(newConfig.obfuscationRequired),
			SmartIdCheck: fromBool(newConfig.smartIdCheck),
			ICH: fromBool(newConfig.ich),
			AllocateFullFile: fromBool(newConfig.allocateFullFile),
		};

		if (process.env.GLUETUN_ENABLED?.toLowerCase() !== 'true') {
			replacements.Port = newConfig.tcpPort;
			replacements.UDPPort = newConfig.udpPort;
		}

		if (!process.env.AMULE_INCOMING_DIR) {
			replacements.IncomingDir = newConfig.incomingDir;
		}
		if (!process.env.AMULE_TEMP_DIR) {
			replacements.TempDir = newConfig.tempDir;
		}

		for (const [key, value] of Object.entries(replacements)) {
			if (value !== undefined) {
				const regex = new RegExp(`^${key}=.*$`, 'm');
				if (content.match(regex)) {
					content = content.replace(regex, `${key}=${value}`);
				}
			}
		}

		fs.writeFileSync(confPath, content, 'utf-8');
	}
}
