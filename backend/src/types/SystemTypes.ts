/**
 * System info wire contract, shared with the frontend through frontend/src/services/apiTypes.ts.
 * Keep this module free of imports (no libraries, no Node APIs): the frontend build type-checks it
 * without backend/node_modules.
 */

/** What a download directory is: the incoming dir, the temp dir or the directory of an aMule category. */
export type DiskRole = 'incoming' | 'temp' | 'categories';

/** A directory downloads can land in. */
export interface DiskDir {
	role: DiskRole;
	path: string;
	/** The category's name, for the 'categories' role. */
	name?: string;
}

/**
 * Free space of a filesystem holding download directories: the incoming dir, the temp dir and the directory of
 * every aMule category with a path of its own. Inside Docker the numbers are those of the host volume mounted
 * there, which is what matters for the downloads. Directories on the same filesystem are reported once, together.
 */
export interface DiskSpace {
	/** The directories on this filesystem, in display order: incoming, temp, then the categories. Never empty. */
	dirs: DiskDir[];
	/** Filesystem size in bytes. */
	total: number;
	/** Bytes available to the process (unprivileged `bavail`, not root's `bfree`). */
	free: number;
}
