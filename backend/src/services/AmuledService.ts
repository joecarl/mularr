import { ChildProcess, exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { __APP_CONFIG__ } from '../app-env';
import { AmuleLogWatcher } from './AmuleLogWatcher';
import { LoggerFactory } from './logging/Logger';
import { sleep } from '../tools/asyncTools';

const execPromise = util.promisify(exec);

export class AmuledService {
	private readonly logger = LoggerFactory.create(this);
	private readonly configDir = __APP_CONFIG__.amule.configDir;
	/** Restart cycles queued or in progress; the daemon reports `isRestarting` while any is pending. */
	private pendingRestarts = 0;
	private _isStopping = false;
	/**
	 * Serializes daemon lifecycle operations (start, restart, config rewrites). Without it a start
	 * requested by MularrMonitoringService can interleave with a restart cycle: the monitor sees the
	 * daemon stopped and spawns it before the new config is written (or spawns a second instance,
	 * since startDaemon removes the lock files), and the cycle's own start is then skipped as
	 * "already running".
	 */
	private lifecycle: Promise<unknown> = Promise.resolve();
	/**
	 * The amuled spawned by this process, tracked through its exit event. Null when none is running
	 * or when it was started elsewhere (e.g. it survived a `tsx watch` restart of the backend in dev).
	 */
	private daemon: ChildProcess | null = null;
	private readonly sharedDirsManager = new AmuleSharedDirsManager(this);
	private readonly logWatcher = new AmuleLogWatcher(this.configDir);

	get configDirectory(): string {
		return this.configDir;
	}

	get isRestarting(): boolean {
		return this.pendingRestarts > 0;
	}

	get isStopping(): boolean {
		return this._isStopping;
	}

	/** Queues `fn` behind any lifecycle operation in progress and returns its result. */
	private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		// `fn` is also the rejection handler, so the queue keeps going after a failed operation
		const run = this.lifecycle.then(fn, fn);
		this.lifecycle = run;
		return run;
	}

	/**
	 * Stops the daemon, runs `whileStopped` (typically a config write: amuled rewrites amule.conf on
	 * shutdown, so writing while it runs gets clobbered) and starts the daemon again, holding
	 * `isRestarting` for the whole cycle so MularrMonitoringService and WsBroadcastService stay out
	 * of the way. The daemon is started again even if `whileStopped` throws.
	 */
	private restartDaemonWith(whileStopped?: () => Promise<void> | void): Promise<void> {
		this.pendingRestarts++; // counted from enqueue time so a queued cycle already reads as restarting
		return this.runExclusive(async () => {
			try {
				await this.stopDaemon();
				try {
					await whileStopped?.();
				} finally {
					await this.startDaemonInternal();
				}
			} finally {
				this.pendingRestarts--;
			}
		});
	}

	/**
	 * Sets the TCP and UDP ports in amule.conf and restarts the daemon so they take effect.
	 * @param port The new TCP and UDP port number to be set in amule.conf.
	 * @returns Whether the configuration changed (and the daemon was therefore restarted).
	 */
	async updateCoreConfig(port: number): Promise<boolean> {
		try {
			const confPath = path.join(this.configDir, 'amule.conf');

			if (!fs.existsSync(confPath)) {
				this.logger.error('amule.conf not found at', confPath);
				return false;
			}

			// Both ports get the same value: VPN port forwarding hands out one port for TCP and UDP
			const withPorts = (content: string) => content.replace(/^Port=\d+$/m, `Port=${port}`).replace(/^UDPPort=\d+$/m, `UDPPort=${port}`);
			const current = fs.readFileSync(confPath, 'utf-8');
			if (withPorts(current) === current) return false; // already set (or no Port lines to update)

			this.logger.info(`Updating amule.conf ports to ${port}`);
			// Re-read inside the cycle: amuled rewrites amule.conf on shutdown, so `current` is stale by then
			await this.restartDaemonWith(() => fs.writeFileSync(confPath, withPorts(fs.readFileSync(confPath, 'utf-8')), 'utf-8'));
			return true;
		} catch (e) {
			this.logger.error('Error updating amule.conf:', e);
		}
		return false;
	}

	private async killDaemon(mode: 'TERM' | 'KILL' = 'TERM'): Promise<void> {
		this.logger.info(`🛑 Sending SIG${mode} to amuled...`);
		if (this.daemon) {
			this.daemon.kill(mode === 'KILL' ? 'SIGKILL' : 'SIGTERM');
			return;
		}
		// Not spawned by us: go through the OS
		try {
			await execPromise(`pkill -${mode} amuled`);
		} catch (e) {
			// Not running — nothing to kill
		}
	}

	/**
	 * Stops the aMule daemon gracefully, and if it doesn't stop within 8 seconds, force kills it.
	 */
	private async stopDaemon(): Promise<void> {
		if (this._isStopping || !(await this.isDaemonRunning())) return; // Process is already stopped or stopping
		this._isStopping = true;
		// Graceful shutdown first
		await this.killDaemon('TERM');

		// Poll until the process is confirmed dead (up to 8 s)
		const killed = await this.waitForProcessDead(8000);
		if (!killed) {
			this.logger.warn('amuled did not stop gracefully, sending SIGKILL...');
			await this.killDaemon('KILL');
			// Give the kernel a moment to reap it
			await sleep(500);
		}
		this._isStopping = false;
	}

	async restartDaemon(): Promise<void> {
		if (this.isRestarting) {
			this.logger.warn('Restart already in progress, skipping duplicate request.');
			return;
		}
		this.logger.info('Restarting aMule daemon...');
		try {
			await this.restartDaemonWith();
		} catch (e) {
			this.logger.error('Failed to restart amuled:', e);
		}
	}

	private async waitForProcessDead(timeoutMs: number): Promise<boolean> {
		const interval = 300;
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (!(await this.isDaemonRunning())) return true; // Process is dead
			await sleep(interval);
		}
		return false;
	}

	private waitForEcPort(timeoutMs: number): Promise<boolean> {
		const { host: ecHost, port: ecPort } = __APP_CONFIG__.amule.ec;
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

	/** Starts the daemon unless it is already running. Serialized with restarts, see `lifecycle`. */
	startDaemon(): Promise<void> {
		return this.runExclusive(() => this.startDaemonInternal());
	}

	private async startDaemonInternal(): Promise<void> {
		// Force kill any zombie amuled that holds the port but isn't responding
		const running = await this.isDaemonRunning();
		if (running) {
			const ecReachable = await this.waitForEcPort(2000);
			if (ecReachable) {
				this.logger.info('aMule daemon already running, skipping start.');
				return;
			}
			this.logger.warn('amuled process found but EC port unreachable — force killing zombie...');
			await this.killDaemon('KILL');
			await sleep(1500);
		}
		// Remove stale lock files that prevent amuled from starting after a hard kill
		for (const lockFile of ['amuled.lock', 'amuled.pid', '.lock', 'muleLock']) {
			try {
				fs.rmSync(path.join(this.configDir, lockFile));
				this.logger.info(`Removed stale lock file: ${lockFile}`);
			} catch {
				// File didn't exist — ignore
			}
		}
		this.logger.info('Starting aMule daemon...');
		const child = spawn('amuled', ['-c', this.configDir], {
			detached: true,
			stdio: 'ignore',
		});
		child.unref();
		child.once('error', (err) => {
			this.logger.error('Failed to spawn amuled:', err.message);
			if (this.daemon === child) this.daemon = null;
		});
		child.once('exit', (code, signal) => {
			this.logger.info(`amuled exited (code ${code}, signal ${signal})`);
			if (this.daemon === child) this.daemon = null;
		});
		this.daemon = child;
		const started = await this.waitForEcPort(30000);
		if (started) {
			this.logger.info('aMule daemon started successfully.');
		} else {
			this.logger.error('aMule daemon may not have started — EC port not reachable after 30 s.');
		}
	}

	/**
	 * Whether an amuled process exists. The daemon we spawned is tracked through its exit event, so
	 * this costs nothing while it runs; pgrep is only used when we don't own one, to detect a daemon
	 * started outside this process.
	 */
	async isDaemonRunning(): Promise<boolean> {
		if (this.daemon) return true;
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
			this.logger.error('Error reading log file:', error);
			return ['Error reading log file'];
		}
	}

	// ── Incremental log watching (delegated to AmuleLogWatcher) ─────────────

	/** Subscribe to new log lines. Returns an unsubscribe function. */
	onLogLines(listener: (lines: string[]) => void): () => void {
		return this.logWatcher.onLines(listener);
	}

	/** Current in-memory log tail, primed and kept up to date by the watcher. */
	getLogLines(): string[] {
		return this.logWatcher.getLines();
	}

	/** Starts the incremental logfile watcher. Idempotent. */
	startLogWatcher(): Promise<void> {
		return this.logWatcher.start();
	}

	stopLogWatcher(): void {
		this.logWatcher.stop();
	}

	async getConfig() {
		const config: any = {
			lockedFields: {
				incomingDir: __APP_CONFIG__.amule.incomingDir !== undefined,
				tempDir: __APP_CONFIG__.amule.tempDir !== undefined,
				sharedDirs: this.sharedDirsManager.isSharedDirsLockedByEnv(),
				ports: __APP_CONFIG__.gluetun.enabled,
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
						?.slice(key.length + 1)
						.trim();

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
				config.previewPrio = findVal('PreviewPrio') === '1';
				config.ipFilterClients = findVal('IpFilterClients') === '1';
				config.ipFilterServers = findVal('IpFilterServers') === '1';
				config.filterLanIps = findVal('FilterLanIPs') === '1';
				config.paranoidFiltering = findVal('ParanoidFiltering') === '1';
				config.ipFilterAutoLoad = findVal('IPFilterAutoLoad') === '1';
				config.ipFilterUrl = findVal('IPFilterURL');
				config.ed2kServersUrl = findVal('Ed2kServersUrl');
				config.filterLevel = findVal('FilterLevel');
				config.ipFilterSystem = findVal('IPFilterSystem') === '1';
			}
		} catch (e) {
			this.logger.warn('Could not read local amule.conf:', e);
		}

		config.sharedDirs = this.sharedDirsManager.getSharedDirectories();

		return config;
	}

	public applySharedDirsFromEnvIfNeeded(): void {
		this.sharedDirsManager.applySharedDirsFromEnvIfNeeded();
	}

	/**
	 * Updates amule.conf with the provided configuration values and restarts the daemon so they take
	 * effect. The file is only written while the daemon is stopped, since amuled rewrites it on shutdown.
	 * @param newConfig An object containing the new configuration values to be set in amule.conf.
	 * @throws Will throw an error if amule.conf is not found, a shared directory path is not absolute, or the file cannot be written.
	 */
	async updateConfig(newConfig: any): Promise<void> {
		const confPath = path.join(this.configDir, 'amule.conf');
		if (!fs.existsSync(confPath)) {
			throw new Error('amule.conf not found');
		}

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
			PreviewPrio: fromBool(newConfig.previewPrio),
			IpFilterClients: fromBool(newConfig.ipFilterClients),
			IpFilterServers: fromBool(newConfig.ipFilterServers),
			FilterLanIPs: fromBool(newConfig.filterLanIps),
			ParanoidFiltering: fromBool(newConfig.paranoidFiltering),
			IPFilterAutoLoad: fromBool(newConfig.ipFilterAutoLoad),
			IPFilterURL: newConfig.ipFilterUrl,
			FilterLevel: newConfig.filterLevel,
			IPFilterSystem: fromBool(newConfig.ipFilterSystem),
		};

		// Fields locked by the environment are never overwritten from the UI (see getConfig().lockedFields)
		if (!__APP_CONFIG__.gluetun.enabled) {
			replacements.Port = newConfig.tcpPort;
			replacements.UDPPort = newConfig.udpPort;
		}

		if (__APP_CONFIG__.amule.incomingDir === undefined) {
			replacements.IncomingDir = newConfig.incomingDir;
		}
		if (__APP_CONFIG__.amule.tempDir === undefined) {
			replacements.TempDir = newConfig.tempDir;
		}

		// Validate before touching the daemon so an invalid request leaves it running
		const sharedDirs =
			!this.sharedDirsManager.isSharedDirsLockedByEnv() && Array.isArray(newConfig.sharedDirs) ? normalizeSharedDirectories(newConfig.sharedDirs) : null;

		await this.restartDaemonWith(async () => {
			if (sharedDirs) {
				this.sharedDirsManager.setSharedDirectories(sharedDirs);
			}

			await sleep(5000); // Give the kernel a moment to release the port

			let content = fs.readFileSync(confPath, 'utf-8');
			for (const [key, value] of Object.entries(replacements)) {
				if (value !== undefined) {
					const regex = new RegExp(`^${key}=.*$`, 'm');
					if (content.match(regex)) {
						content = content.replace(regex, `${key}=${value}`);
					}
				}
			}

			fs.writeFileSync(confPath, content, 'utf-8');
		});
	}
}

interface SharedDirectoryEntry {
	path: string;
	recursive: boolean;
}

function normalizeSharedDirectories(entries: unknown[]): SharedDirectoryEntry[] {
	const merged = new Map<string, boolean>();

	for (const item of entries) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const candidatePath = (item as { path?: unknown }).path;
		const candidateRecursive = (item as { recursive?: unknown }).recursive;
		if (typeof candidatePath !== 'string') {
			continue;
		}

		const trimmedPath = candidatePath.trim();
		if (!trimmedPath) {
			continue;
		}
		if (!path.isAbsolute(trimmedPath)) {
			throw new Error(`Shared directory path must be absolute: ${trimmedPath}`);
		}

		const recursive = candidateRecursive === true;
		const previous = merged.get(trimmedPath);
		merged.set(trimmedPath, recursive || previous === true);
	}

	return Array.from(merged.entries()).map(([entryPath, recursive]) => ({
		path: entryPath,
		recursive,
	}));
}

class AmuleSharedDirsManager {
	private readonly logger = LoggerFactory.create(this);
	private readonly sharedDirRecursiveFile = 'shareddir-recursive.dat';
	private readonly sharedDirExplicitFile = 'shareddir-explicit.dat';
	private readonly sharedDirFile = 'shareddir.dat'; // legacy file, used internally by amule, must be removed before writing new shared directories

	constructor(private readonly amuledService: AmuledService) {}

	get configDir(): string {
		return this.amuledService.configDirectory;
	}

	public isSharedDirsLockedByEnv(): boolean {
		const { sharedDirsRecursive, sharedDirsExplicit } = __APP_CONFIG__.amule;
		return sharedDirsRecursive !== undefined || sharedDirsExplicit !== undefined;
	}

	private readPathListFile(fileName: string): string[] {
		const filePath = path.join(this.configDir, fileName);
		if (!fs.existsSync(filePath)) {
			return [];
		}

		return fs
			.readFileSync(filePath, 'utf-8')
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
	}

	private writePathListFile(fileName: string, paths: string[]): void {
		const filePath = path.join(this.configDir, fileName);
		const content = paths.length > 0 ? `${paths.join('\n')}\n` : '';
		this.logger.debug(`Writing to ${filePath}:`);
		this.logger.debug(content);
		fs.writeFileSync(filePath, content, 'utf-8');
	}

	public getSharedDirectories(): SharedDirectoryEntry[] {
		const recursiveDirs = this.readPathListFile(this.sharedDirRecursiveFile);
		const explicitDirs = this.readPathListFile(this.sharedDirExplicitFile);

		const merged = new Map<string, boolean>();
		for (const dirPath of recursiveDirs) {
			if (!path.isAbsolute(dirPath)) {
				continue;
			}
			merged.set(dirPath, true);
		}
		for (const dirPath of explicitDirs) {
			if (!path.isAbsolute(dirPath)) {
				continue;
			}
			if (!merged.has(dirPath)) {
				merged.set(dirPath, false);
			}
		}

		return Array.from(merged.entries()).map(([entryPath, recursive]) => ({
			path: entryPath,
			recursive,
		}));
	}

	public setSharedDirectories(entries: SharedDirectoryEntry[]): void {
		const recursiveDirs = entries.filter((entry) => entry.recursive).map((entry) => entry.path);
		const explicitDirs = entries.filter((entry) => !entry.recursive).map((entry) => entry.path);

		// Remove legacy sharedDirFile before writing new shared directories
		const legacyFilePath = path.join(this.configDir, this.sharedDirFile);
		if (fs.existsSync(legacyFilePath)) {
			fs.unlinkSync(legacyFilePath);
		}

		this.logger.debug('Writing shared directories:');
		this.logger.debug('Recursive:', recursiveDirs);
		this.writePathListFile(this.sharedDirRecursiveFile, recursiveDirs);
		this.logger.debug('Explicit:', explicitDirs);
		this.writePathListFile(this.sharedDirExplicitFile, explicitDirs);
	}

	public applySharedDirsFromEnvIfNeeded(): void {
		if (!this.isSharedDirsLockedByEnv()) {
			return;
		}

		fs.mkdirSync(this.configDir, { recursive: true });

		const { sharedDirsRecursive = [], sharedDirsExplicit = [] } = __APP_CONFIG__.amule;
		const normalized = normalizeSharedDirectories([
			...sharedDirsRecursive.map((dir) => ({ path: dir, recursive: true })),
			...sharedDirsExplicit.map((dir) => ({ path: dir, recursive: false })),
		]);

		this.logger.info('Applying shared directories from environment variables...');
		this.setSharedDirectories(normalized);
	}
}
