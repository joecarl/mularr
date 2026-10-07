/** Resolves after `ms` milliseconds; `sleep(0)` yields to the event loop. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
