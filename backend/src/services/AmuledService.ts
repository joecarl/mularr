import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execPromise = util.promisify(exec);

export class AmuledService {
	private readonly configDir = process.env.AMULE_CONFIG_DIR || path.join(process.env.HOME || '/home/node', '.aMule');

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
		console.log('Restarting aMule daemon...');
		try {
			// Kill existing
			try {
				await execPromise('pkill amuled');
			} catch (e) {
				// Ignore if not running
			}

			// Wait a moment
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Start new
			const child = spawn('amuled', ['-c', this.configDir, '-f'], {
				detached: true,
				stdio: 'ignore',
			});
			child.unref();

			console.log('aMule daemon restart triggered.');
		} catch (e) {
			console.error('Failed to restart amuled:', e);
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
		const config: any = {};

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
				config.downloadCap = findVal('DownloadCapacity');
				config.uploadCap = findVal('UploadCapacity');
				config.incomingDir = findVal('IncomingDir');
				config.tempDir = findVal('TempDir');
			}
		} catch (e) {
			console.warn('Could not read local amule.conf:', e);
		}

		return config;
	}
}
