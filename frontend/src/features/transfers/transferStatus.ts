export const statusMap: Record<number, string> = {
	0: 'Downloading',
	1: 'Empty',
	2: 'Waiting for Hash',
	3: 'Hashing',
	4: 'Error',
	5: 'Insufficient Space',
	6: 'Unknown',
	7: 'Paused',
	8: 'Completing',
	9: 'Completed',
	10: 'Allocating',
	// Custom statuses for other providers like Telegram downloads
	11: 'Queued',
};
