export const VIDEO_EXTENSIONS = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'mpg', 'mpeg', 'divx'];

export function isVideoFile(filename: string): boolean {
	const ext = filename.split('.').pop()?.toLowerCase() || '';
	return VIDEO_EXTENSIONS.includes(ext);
}
