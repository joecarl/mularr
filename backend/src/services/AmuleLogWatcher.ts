import fs from 'fs';
import path from 'path';

/**
 * AmuleLogWatcher
 *
 * Plain helper class (not a container service) that incrementally follows
 * aMule's logfile: it watches the config directory, reads only newly appended
 * bytes and emits complete lines to subscribers, keeping an in-memory tail
 * buffer. Tolerates logfile rotation/truncation and partially written lines.
 */
export class AmuleLogWatcher {
	/** Max log lines kept in the in-memory buffer (also the size of the initial snapshot). */
	private static readonly BUFFER_MAX = 500;
	/** Upper bound of logfile bytes read in a single pass; older data is skipped. */
	private static readonly TAIL_BYTES = 64 * 1024;

	private buffer: string[] = [];
	private offset = 0;
	private watcher: fs.FSWatcher | null = null;
	private resyncTimer: NodeJS.Timeout | null = null;
	private readChain: Promise<void> = Promise.resolve();
	private initPromise: Promise<void> | null = null;
	private primed = false;
	private readonly listeners = new Set<(lines: string[]) => void>();

	constructor(private readonly configDir: string) {}

	/** Subscribe to new log lines. Returns an unsubscribe function. */
	onLines(listener: (lines: string[]) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Current in-memory log tail, primed and kept up to date by the watcher. */
	getLines(): string[] {
		return [...this.buffer];
	}

	/**
	 * Starts watching the logfile and reading only newly appended bytes,
	 * emitting complete lines to subscribers as soon as they are written.
	 * Idempotent; resolves once the initial tail has been loaded.
	 */
	start(): Promise<void> {
		if (!this.initPromise) this.initPromise = this.init();
		return this.initPromise;
	}

	stop(): void {
		this.watcher?.close();
		this.watcher = null;
		if (this.resyncTimer) clearInterval(this.resyncTimer);
		this.resyncTimer = null;
		this.initPromise = null;
		this.primed = false;
	}

	private async init(): Promise<void> {
		// Prime the buffer with the current tail of the logfile; these lines are
		// part of the initial snapshot, so they are not emitted to subscribers
		await this.enqueueRead();
		this.primed = true;

		try {
			// Watch the directory so the watcher survives logfile rotation/recreation
			this.watcher = fs.watch(this.configDir, (_event, filename) => {
				if (filename === 'logfile') this.enqueueRead();
			});
			this.watcher.on('error', (err) => console.error('Log watcher error:', err.message));
		} catch (e) {
			console.error('Could not start log watcher:', e);
		}

		// Low-frequency resync in case a filesystem event is missed
		this.resyncTimer = setInterval(() => this.enqueueRead(), 10_000);
	}

	/** Serializes log reads so concurrent watch events cannot interleave. */
	private enqueueRead(): Promise<void> {
		this.readChain = this.readChain
			.then(() => this.readNewData())
			.catch((e) => console.error('Error reading log file:', e));
		return this.readChain;
	}

	private async readNewData(): Promise<void> {
		const logPath = path.join(this.configDir, 'logfile');
		if (!fs.existsSync(logPath)) return;
		const { size } = await fs.promises.stat(logPath);
		if (size < this.offset) this.offset = 0; // logfile was truncated or recreated
		if (size === this.offset) return;

		// If we are too far behind (first read, rotation, missed events), jump to the tail
		const jumped = size - this.offset > AmuleLogWatcher.TAIL_BYTES;
		const start = jumped ? size - AmuleLogWatcher.TAIL_BYTES : this.offset;

		const chunk = await this.readFileRange(logPath, start, size);
		// Only consume up to the last complete line; a partially written line is
		// left in the file and picked up on the next read.
		const lastNL = chunk.lastIndexOf(0x0a);
		if (lastNL === -1) {
			if (jumped) this.offset = start;
			return;
		}
		this.offset = start + lastNL + 1;

		let text = chunk.subarray(0, lastNL + 1).toString('utf-8');
		// A jump lands mid-line: discard the leading partial line
		if (jumped) text = text.slice(text.indexOf('\n') + 1);
		const lines = text.split('\n').filter((l) => l.trim() !== '');
		if (lines.length === 0) return;

		this.buffer = [...this.buffer, ...lines].slice(-AmuleLogWatcher.BUFFER_MAX);
		if (this.primed) {
			for (const listener of this.listeners) listener(lines);
		}
	}

	private async readFileRange(filePath: string, start: number, end: number): Promise<Buffer> {
		const fh = await fs.promises.open(filePath, 'r');
		try {
			const buf = Buffer.alloc(end - start);
			const { bytesRead } = await fh.read(buf, 0, buf.length, start);
			return buf.subarray(0, bytesRead);
		} finally {
			await fh.close();
		}
	}
}
