import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { container } from './container/ServiceContainer';
import { AmuleService } from './AmuleService';
import { AmuledService } from './AmuledService';
import { SystemService } from './SystemService';
import { MediaProviderService } from './mediaprovider';
import { SpeedHistoryService } from './SpeedHistoryService';

interface WsMessage {
	type: string;
	data: unknown;
}

/**
 * WsBroadcastService
 *
 * Attaches a WebSocket server to the existing HTTP server and periodically
 * pushes telemetry data to all connected clients.  The REST API is left
 * unchanged; this service only handles server-initiated broadcasts.
 *
 * Message types (server → client):
 *   amule:status       – AmuleService.getStats()           every 4 s
 *   media:transfers    – MediaProviderService.getTransfers() every 2 s
 *   amule:upload-queue – AmuleService.getUploadQueue()     every 2 s
 *   amule:shared       – AmuleService.getSharedFiles()     every 2 s
 *   amule:log          – AmuledService.getLog()            every 3 s
 *   amule:servers      – AmuleService.getServers()         every 10 s
 *   system:info        – SystemService.getSystemInfo()     every 5 min
 *   stats:speed-history – full history on client connect
 *   stats:speed-sample  – new sample from SpeedHistoryService on each tick
 */
export class WsBroadcastService {
	private wss: WebSocketServer | null = null;
	private intervals: NodeJS.Timeout[] = [];
	private lastRestartingState = false;

	private readonly amule = container.get(AmuleService);
	private readonly amuled = container.get(AmuledService);
	private readonly media = container.get(MediaProviderService);
	private readonly system = container.get(SystemService);
	private readonly speedHistory = container.get(SpeedHistoryService);

	/** Attach the WebSocket server to the provided HTTP server instance. */
	public setup(httpServer: Server): void {
		this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

		this.wss.on('connection', (ws: WebSocket, req) => {
			console.log(`[WS] Client connected from ${req.socket.remoteAddress}`);

			ws.on('close', () => console.log('[WS] Client disconnected'));
			ws.on('error', (err) => console.error('[WS] Client error:', err.message));

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

		// Transfers, upload-queue and shared files at 2 s
		this.intervals.push(setInterval(() => this.pollFast(), 2000));

		// aMule log at 3 s
		this.intervals.push(setInterval(() => this.pollLog(), 3000));

		// aMule global status at 4 s
		this.intervals.push(setInterval(() => this.pollStatus(), 4000));

		// Server list at 10 s
		this.intervals.push(setInterval(() => this.pollServers(), 10_000));

		// System / VPN info at 5 min
		this.intervals.push(setInterval(() => this.pollSystemInfo(), 300_000));

		// Notify clients of restart state changes
		this.intervals.push(setInterval(() => this.pollRestartingStatus(), 1000));
	}

	public stop(): void {
		for (const id of this.intervals) clearInterval(id);
		this.intervals = [];
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
			this.amuled.getLog(100).then((lines) => this.send(ws, { type: 'amule:log', data: { lines } })),
			this.system.getSystemInfo().then((d) => this.send(ws, { type: 'system:info', data: d })),
		]);
	}

	// ── Periodic broadcast handlers ────────────────────────────────────────────

	private async pollFast(): Promise<void> {
		if (this.openClientCount() === 0 || this.amuled.isRestarting) return;
		await Promise.allSettled([
			this.media
				.getTransfers()
				.then((d) => this.broadcast({ type: 'media:transfers', data: d }))
				.catch((e) => console.error('[WS] transfers error:', (e as Error).message)),
			this.amule
				.getUploadQueue()
				.then((d) => this.broadcast({ type: 'amule:upload-queue', data: d }))
				.catch((e) => console.error('[WS] upload-queue error:', (e as Error).message)),
			this.amule
				.getSharedFiles()
				.then((d) => this.broadcast({ type: 'amule:shared', data: d }))
				.catch((e) => console.error('[WS] shared error:', (e as Error).message)),
		]);
	}

	private async pollLog(): Promise<void> {
		if (this.openClientCount() === 0 || this.amuled.isRestarting) return;
		try {
			const lines = await this.amuled.getLog(100);
			this.broadcast({ type: 'amule:log', data: { lines } });
		} catch (e) {
			console.error('[WS] log error:', (e as Error).message);
		}
	}

	private async pollStatus(): Promise<void> {
		if (this.openClientCount() === 0 || this.amuled.isRestarting) return;
		try {
			const status = await this.amule.getStats();
			this.broadcast({ type: 'amule:status', data: status });
		} catch (e) {
			console.error('[WS] status error:', (e as Error).message);
		}
	}

	private async pollServers(): Promise<void> {
		if (this.openClientCount() === 0 || this.amuled.isRestarting) return;
		try {
			const servers = await this.amule.getServers();
			this.broadcast({ type: 'amule:servers', data: servers });
		} catch (e) {
			console.error('[WS] servers error:', (e as Error).message);
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
			console.error('[WS] system-info error:', (e as Error).message);
		}
	}
}
