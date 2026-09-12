import { __APP_CONFIG__ } from '../app-env';
import { LoggerFactory } from '../services/logging/Logger';
import { getMockWorld } from './MockWorld';

/** How long a simulated daemon restart keeps `isRestarting` up, so the UI banner can be seen. */
const RESTART_MS = 3000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stand-in for AmuledService in MOCK_MODE. There is no process to spawn or amule.conf to rewrite: the
 * daemon is always "running", the configuration lives in MockWorld and a restart is a short pause.
 */
export class MockAmuledService {
	private readonly logger = LoggerFactory.create(this);
	private readonly world = getMockWorld();
	private restarting = false;

	get configDirectory(): string {
		return __APP_CONFIG__.amule.configDir;
	}

	get isRestarting(): boolean {
		return this.restarting;
	}

	get isStopping(): boolean {
		return false;
	}

	async updateCoreConfig(port: number): Promise<boolean> {
		const config = this.world.amuleConfig;
		if (config.tcpPort === String(port) && config.udpPort === String(port)) return false;
		this.logger.info(`Updating amule.conf ports to ${port}`);
		await this.restartWith(() => {
			config.tcpPort = String(port);
			config.udpPort = String(port);
		});
		return true;
	}

	async restartDaemon(): Promise<void> {
		if (this.restarting) {
			this.logger.warn('Restart already in progress, skipping duplicate request.');
			return;
		}
		this.logger.info('Restarting aMule daemon...');
		await this.restartWith();
	}

	private async restartWith(whileStopped?: () => void): Promise<void> {
		this.restarting = true;
		this.world.disconnectFromServer();
		this.world.appendLog('aMule shutdown initiated.');
		try {
			await sleep(RESTART_MS / 2);
			whileStopped?.();
			await sleep(RESTART_MS / 2);
		} finally {
			this.restarting = false;
		}
		this.world.appendLog('Initialising aMule 3.0.1 compiled with wxGTK2 v3.2.4');
		const server = this.world.servers[0];
		if (server) this.world.connectToServer(server.ip, server.port);
	}

	async startDaemon(): Promise<void> {
		this.logger.info('aMule daemon already running (simulated), skipping start.');
	}

	async isDaemonRunning(): Promise<boolean> {
		return true;
	}

	async getLog(lines: number = 50): Promise<string[]> {
		return this.world.getLogLines().slice(-lines);
	}

	onLogLines(listener: (lines: string[]) => void): () => void {
		return this.world.onLogLines(listener);
	}

	getLogLines(): string[] {
		return this.world.getLogLines();
	}

	async startLogWatcher(): Promise<void> {}

	stopLogWatcher(): void {}

	async getConfig(): Promise<any> {
		return {
			lockedFields: {
				incomingDir: __APP_CONFIG__.amule.incomingDir !== undefined,
				tempDir: __APP_CONFIG__.amule.tempDir !== undefined,
				sharedDirs: this.isSharedDirsLockedByEnv(),
				ports: __APP_CONFIG__.gluetun.enabled,
			},
			...this.world.amuleConfig,
			sharedDirs: this.world.sharedDirs.map((d) => ({ ...d })),
		};
	}

	private isSharedDirsLockedByEnv(): boolean {
		const { sharedDirsRecursive, sharedDirsExplicit } = __APP_CONFIG__.amule;
		return sharedDirsRecursive !== undefined || sharedDirsExplicit !== undefined;
	}

	applySharedDirsFromEnvIfNeeded(): void {}

	/** Applies the fields the real service would write to amule.conf, honouring the same environment locks. */
	async updateConfig(newConfig: any): Promise<void> {
		const locked = new Set<string>();
		if (__APP_CONFIG__.gluetun.enabled) locked.add('tcpPort').add('udpPort');
		if (__APP_CONFIG__.amule.incomingDir !== undefined) locked.add('incomingDir');
		if (__APP_CONFIG__.amule.tempDir !== undefined) locked.add('tempDir');
		await this.restartWith(() => {
			for (const key of Object.keys(this.world.amuleConfig)) {
				if (!locked.has(key) && newConfig[key] !== undefined) this.world.amuleConfig[key] = newConfig[key];
			}
			if (!this.isSharedDirsLockedByEnv() && Array.isArray(newConfig.sharedDirs)) {
				this.world.sharedDirs = newConfig.sharedDirs
					.filter((d: unknown) => d && typeof d === 'object' && typeof (d as { path?: unknown }).path === 'string')
					.map((d: { path: string; recursive?: unknown }) => ({ path: d.path.trim(), recursive: d.recursive === true }));
			}
		});
	}
}
