import { onUnmount, type WritableSignal } from 'chispa';

/**
 * Smart polling function that ensures only one instance of the async function is running at a time.
 * If the function is still running when the next interval hits, it will set a flag to run again immediately after the current one finishes.
 * @param sig The signal to update with the result of the async function.
 * @param fn The async function to poll.
 * @param interval The polling interval in milliseconds.
 * @return A function to manually trigger the polling immediately.
 */
export function smartPoll<T>(sig: WritableSignal<T>, fn: () => Promise<T>, interval = 2000) {
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
			const result = await fn();
			sig.set(result);
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
