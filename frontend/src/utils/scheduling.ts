import { onUnmount, signal } from 'chispa';

// ── Load error log ────────────────────────────────────────────────────────────

export interface LoadError {
	label: string;
	message: string;
	ts: number;
}

const MAX_LOG_ENTRIES = 50;

/** Reactive log of recent load errors produced by smartLoad calls. */
export const loadErrors = signal<LoadError[]>([]);

/**
 * Wraps an async load function in a try/catch so the caller doesn't need to.
 * Errors are logged to the console and appended to the reactive `loadErrors` signal.
 * @param fn   The async function to execute (no try/catch needed inside).
 * @param label Identifier used in logs to locate the source of the error.
 */
export function smartLoad<T>(fn: () => Promise<T>, label: string): () => Promise<T | undefined> {
	return async () => {
		try {
			return await fn();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error(`[load:${label}]`, e);
			const entry: LoadError = { label, message, ts: Date.now() };
			const prev = loadErrors.get();
			loadErrors.set(prev.length >= MAX_LOG_ENTRIES ? [...prev.slice(1), entry] : [...prev, entry]);
			return undefined;
		}
	};
}

// ── Smart poll ────────────────────────────────────────────────────────────────

/**
 * Smart polling function that ensures only one instance of the async function is running at a time.
 * If the function is still running when the next interval hits, it will set a flag to run again immediately after the current one finishes.
 * @param fn The async function to poll.
 * @param interval The polling interval in milliseconds.
 * @return A function to manually trigger the polling immediately.
 */
export function smartPoll<T>(fn: () => Promise<T>, interval = 2000) {
	let isPolling = false;
	let pending = false;

	const poll = async () => {
		if (isPolling) {
			console.log('Poll already in progress, scheduling another run after completion');
			pending = true;
			return;
		}
		isPolling = true;
		try {
			await fn();
		} catch (e) {
			console.error('Error in smartPoll:', e);
		} finally {
			isPolling = false;
			if (pending) {
				pending = false;
				poll();
			}
		}
	};

	const intervalId = setInterval(poll, interval);
	onUnmount(() => clearInterval(intervalId));

	poll();
	return poll;
}
