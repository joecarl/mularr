import { container } from './container/ServiceContainer';
import { MediaProviderService } from './mediaprovider';
import { AmuleService } from './AmuleService';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpeedSample {
	/** Unix timestamp (ms) */
	ts: number;
	/** Download speed (B/s) summed from active aMule transfers */
	dlAmule: number;
	/** Download speed (B/s) summed from active Telegram transfers */
	dlTelegram: number;
	/** Total download speed (B/s) – sum of all providers */
	dlTotal: number;
	/** Upload speed (B/s) from aMule global stat */
	ulAmule: number;
	/** Number of active aMule transfers */
	activeAmule: number;
	/** Number of active Telegram transfers */
	activeTelegram: number;
	/** Total number of shared files */
	totalShared: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000; // 5 s
const MAX_SAMPLES = 2_160; // 3 h at 5 s intervals

export class SpeedHistoryService {
	/** Circular buffer stored as a plain array (oldest first). */
	private history: SpeedSample[] = [];
	private intervalId: NodeJS.Timeout | null = null;

	// Lazy-resolve services so the service can be constructed before they are registered
	private get mediaProvider(): MediaProviderService {
		return container.get(MediaProviderService);
	}
	private get amuleService(): AmuleService {
		return container.get(AmuleService);
	}

	public start(): void {
		console.log('[SpeedHistory] Starting speed-history polling...');
		this.poll();
		this.intervalId = setInterval(() => this.poll(), POLL_INTERVAL_MS);
	}

	public stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	/** Return a copy of the full history array. */
	public getHistory(): SpeedSample[] {
		return this.history.slice();
	}

	/** Return only the most recent sample, or null if no data yet. */
	public getLatest(): SpeedSample | null {
		return this.history.length ? this.history[this.history.length - 1] : null;
	}

	private async poll(): Promise<void> {
		try {
			const [transfersResp, amuleStats] = await Promise.allSettled([this.mediaProvider.getTransfers(), this.amuleService.getStats()]);

			// ── Compute per-provider download speeds from active transfers ──────
			let dlAmule = 0;
			let dlTelegram = 0;
			let activeAmule = 0;
			let activeTelegram = 0;

			if (transfersResp.status === 'fulfilled') {
				const active = (transfersResp.value.list ?? []).filter((t) => !t.isCompleted && !t.stopped);
				for (const t of active) {
					const spd = t.speed ?? 0;
					if (t.provider === 'amule') {
						dlAmule += spd;
						activeAmule++;
					} else if (t.provider === 'telegram') {
						dlTelegram += spd;
						activeTelegram++;
					} else {
						// Unknown provider counts toward total
						dlAmule += spd;
						activeAmule++;
					}
				}
			} else {
				console.warn('[SpeedHistory] Failed to get transfers:', transfersResp.reason);
			}

			// ── Upload speed from aMule global status ─────────────────────────
			let ulAmule = 0;
			let totalShared = 0;
			if (amuleStats.status === 'fulfilled') {
				ulAmule = (amuleStats.value as any)?.uploadSpeed ?? 0;
				totalShared = (amuleStats.value as any)?.sharedFileCount ?? 0;
			}

			const sample: SpeedSample = {
				ts: Date.now(),
				dlAmule,
				dlTelegram,
				dlTotal: dlAmule + dlTelegram,
				ulAmule,
				activeAmule,
				activeTelegram,
				totalShared,
			};

			// Push sample, drop oldest if buffer is full
			if (this.history.length >= MAX_SAMPLES) {
				this.history.shift();
			}
			this.history.push(sample);
		} catch (err) {
			console.error('[SpeedHistory] Unexpected error during poll:', err);
		}
	}
}
