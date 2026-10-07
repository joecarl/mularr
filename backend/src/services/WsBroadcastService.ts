import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { container } from './container/ServiceContainer';
import { AmuleService } from './AmuleService';
import { AmuledService } from './AmuledService';
import { SystemService } from './SystemService';
import { MediaProviderService } from './mediaprovider';
import { SpeedHistoryService } from './SpeedHistoryService';
import { authenticateRequest } from '../middleware/authMiddleware';
import { LoggerFactory } from './logging/Logger';

interface WsMessage {
	type: string;
	data: unknown;
}

/** Application-defined close code (4000–4999 range) sent to clients that fail authentication. */
const WS_CLOSE_UNAUTHORIZED = 4401;

/**
 * WsBroadcastService
 *
 * Attaches a WebSocket server to the existing HTTP server and periodically
 * pushes telemetry data to all connected clients.  The REST API is left
 * unchanged; this service only handles server-initiated broadcasts.
 *
 * Authentication: the upgrade request is checked with the same rules as the
 * REST API (see authenticateRequest). Browsers can't set headers on a
 * WebSocket, so the UI passes its JWT as `/ws?token=<jwt>`. Unauthenticated
 * clients are closed with code 4401 before any data is sent.
 *
 * Message types (server → client):
 *   amule:status       – AmuleService.getStats()           every 4 s
 *   media:transfers    – MediaProviderService.getTransfers() every 2 s
 *   amule:upload-queue – AmuleService.getUploadQueue()     every 2 s
 *   amule:shared       – AmuleService.getSharedFiles()     every 4 s
 *   amule:log          – snapshot of recent lines on client connect
 *   amule:log-append   – new lines pushed as amuled writes them (file watcher)
 *   amule:servers      – AmuleService.getServers()         every 10 s
 *   system:info        – SystemService.getSystemInfo()     every 60 s (VPN, public IP, disk space)
 *   stats:speed-history – full history on client connect
 *   stats:speed-sample  – new sample from SpeedHistoryService on each tick
 */
export class WsBroadcastService {
	private readonly logger = LoggerFactory.create(this);
	private wss: WebSocketServer | null = null;
	private intervals: NodeJS.Timeout[] = [];
	private lastRestartingState = false;
	private logUnsubscribe: (() => void) | null = null;

	private readonly amule = container.get(AmuleService);
	private readonly amuled = container.get(AmuledService);
	private readonly media = container.get(MediaProviderService);
	private readonly system = container.get(SystemService);
	private readonly speedHistory = container.get(SpeedHistoryService);

	/** Attach the WebSocket server to the provided HTTP server instance. */
	public setup(httpServer: Server): void {
		this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

		this.wss.on('connection', (ws: WebSocket, req) => {
			if (!authenticateRequest(req).authorized) {
				this.logger.warn(`Unauthorized client from ${req.socket.remoteAddress}, closing`);
				// close() moves the socket to CLOSING synchronously, so broadcast() will skip it.
				ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized');
				return;
			}

			this.logger.info(`Client connected from ${req.socket.remoteAddress}`);

			ws.on('close', () => this.logger.info('Client disconnected'));
			ws.on('error', (err) => this.logger.error('Client error:', err.message));

			// Immediately feed the new client with current snapshots so it
			// doesn't have to wait for the next broadcast cycle.
			this.sendInitialData(ws);
		});
	}

	/** Start periodic broadcast loops and hook into SpeedHistoryService. */
	public start(): void {
		// Subscribe to speed samples produced by SpeedHistoryService
		this.speedHistory.onSample((sample) => {
			this.broadcast({ type: 'stats:speed-sample', data: sample });
		});

		// Transfers and upload-queue at 2 s
		this.intervals.push(setInterval(() => this.pollFast(), 2000));

		// Incremental aMule log feed: push new lines as soon as amuled writes them
		this.amuled.startLogWatcher().catch((e) => this.logger.error('amuled log watcher error:', (e as Error).message));
		this.logUnsubscribe = this.amuled.onLogLines((lines) => {
			this.broadcast({ type: 'amule:log-append', data: { lines } });
		});

		// aMule global status and shared files at 4 s
		this.intervals.push(setInterval(() => this.pollStatus(), 4000));

		// Server list at 10 s
		this.intervals.push(setInterval(() => this.pollServers(), 10_000));

		// System info at 60 s: the disk space moves with the downloads; the public IP lookups inside are cached (see SystemService)
		this.intervals.push(setInterval(() => this.pollSystemInfo(), 60_000));

		// Notify clients of restart state changes
		this.intervals.push(setInterval(() => this.pollRestartingStatus(), 1000));
	}

	public stop(): void {
		for (const id of this.intervals) clearInterval(id);
		this.intervals = [];
		this.logUnsubscribe?.();
		this.logUnsubscribe = null;
		this.amuled.stopLogWatcher();
		this.wss?.close();
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private openClientCount(): number {
		if (!this.wss) return 0;
		let n = 0;
		this.wss.clients.forEach((ws) => {
			if (ws.readyState === WebSocket.OPEN) n++;
		});
		return n;
	}

	private broadcast(msg: WsMessage): void {
		if (!this.wss) return;
		const payload = JSON.stringify(msg);
		this.wss.clients.forEach((ws) => {
			if (ws.readyState === WebSocket.OPEN) ws.send(payload);
		});
	}

	private send(ws: WebSocket, msg: WsMessage): void {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
	}

	private async readyToPoll(): Promise<boolean> {
		return this.openClientCount() > 0 && !this.amuled.isRestarting && !this.amuled.isStopping && (await this.amuled.isDaemonRunning());
	}

	// ── Initial data burst on connect ──────────────────────────────────────────

	private async sendInitialData(ws: WebSocket): Promise<void> {
		// Speed history (full buffer)
		this.send(ws, { type: 'stats:speed-history', data: { samples: this.speedHistory.getHistory() } });

		await Promise.allSettled([
			this.amule.getStats().then((d) => this.send(ws, { type: 'amule:status', data: d })),
			this.media.getTransfers().then((d) => this.send(ws, { type: 'media:transfers', data: d })),
			this.amule.getUploadQueue().then((d) => this.send(ws, { type: 'amule:upload-queue', data: d })),
			this.amule.getServers().then((d) => this.send(ws, { type: 'amule:servers', data: d })),
			this.amule.getSharedFiles().then((d) => this.send(ws, { type: 'amule:shared', data: d })),
			this.amuled.startLogWatcher().then(() => this.send(ws, { type: 'amule:log', data: { lines: this.amuled.getLogLines() } })),
			this.system.getSystemInfo().then((d) => this.send(ws, { type: 'system:info', data: d })),
		]);
	}

	// ── Periodic broadcast handlers ────────────────────────────────────────────

	private async pollFast(): Promise<void> {
		if (!(await this.readyToPoll())) return;
		await Promise.allSettled([
			this.media
				.getTransfers()
				.then((d) => this.broadcast({ type: 'media:transfers', data: d }))
				.catch((e) => this.logger.error('Transfers error:', (e as Error).message)),
			this.amule
				.getUploadQueue()
				.then((d) => this.broadcast({ type: 'amule:upload-queue', data: d }))
				.catch((e) => this.logger.error('Upload-queue error:', (e as Error).message)),
		]);
	}

	private async pollStatus(): Promise<void> {
		if (!(await this.readyToPoll())) return;
		await Promise.allSettled([
			this.amule
				.getStats()
				.then((d) => this.broadcast({ type: 'amule:status', data: d }))
				.catch((e) => this.logger.error('Status error:', (e as Error).message)),
			this.amule
				.getSharedFiles()
				.then((d) => this.broadcast({ type: 'amule:shared', data: d }))
				.catch((e) => this.logger.error('Shared error:', (e as Error).message)),
		]);
	}

	private async pollServers(): Promise<void> {
		if (!(await this.readyToPoll())) return;
		try {
			const servers = await this.amule.getServers();
			this.broadcast({ type: 'amule:servers', data: servers });
		} catch (e) {
			this.logger.error('Servers error:', (e as Error).message);
		}
	}

	private pollRestartingStatus(): void {
		const restarting = this.amuled.isRestarting;
		if (restarting !== this.lastRestartingState) {
			this.lastRestartingState = restarting;
			this.broadcast({ type: 'amule:restarting', data: { restarting } });
		}
	}

	private async pollSystemInfo(): Promise<void> {
		if (this.openClientCount() === 0) return;
		try {
			const info = await this.system.getSystemInfo();
			this.broadcast({ type: 'system:info', data: info });
		} catch (e) {
			this.logger.error('System-info error:', (e as Error).message);
		}
	}
}
