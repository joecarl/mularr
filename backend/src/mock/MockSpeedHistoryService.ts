import type { SpeedSample } from '../types/StatsTypes';
import { LoggerFactory } from '../services/logging/Logger';
import { getMockWorld } from './MockWorld';

// Same window as SpeedHistoryService, so the dashboard chart is full from the first paint
const POLL_INTERVAL_MS = 5_000;
const MAX_SAMPLES = 2_160;

/**
 * Stand-in for SpeedHistoryService in MOCK_MODE. A fresh process has no past to sample, so the buffer is
 * backfilled with a plausible 3 h curve from MockWorld and then extended with live samples like the real one.
 */
export class MockSpeedHistoryService {
	private readonly logger = LoggerFactory.create(this);
	private readonly world = getMockWorld();
	private history: SpeedSample[] = this.world.buildSpeedHistory(MAX_SAMPLES - 1, POLL_INTERVAL_MS);
	private intervalId: NodeJS.Timeout | null = null;
	private sampleCallbacks: ((sample: SpeedSample) => void)[] = [];

	public onSample(cb: (sample: SpeedSample) => void): void {
		this.sampleCallbacks.push(cb);
	}

	public start(): void {
		this.logger.info('Starting speed-history polling (simulated)...');
		this.intervalId = setInterval(() => this.record(), POLL_INTERVAL_MS);
	}

	public stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	public getHistory(): SpeedSample[] {
		return this.history.slice();
	}

	public getLatest(): SpeedSample | null {
		return this.history.length ? this.history[this.history.length - 1] : null;
	}

	private record(): void {
		const sample = this.world.currentSpeedSample();
		if (this.history.length >= MAX_SAMPLES) this.history.shift();
		this.history.push(sample);
		for (const cb of this.sampleCallbacks) {
			try {
				cb(sample);
			} catch {
				/* ignore listener errors */
			}
		}
	}
}
