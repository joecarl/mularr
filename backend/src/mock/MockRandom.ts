/**
 * Small deterministic PRNG (mulberry32). Every mock draws from one seeded instance, so the generated
 * dataset, and therefore a screenshot, is the same on every start.
 */
export class MockRandom {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0;
	}

	/** Uniform float in [0, 1). */
	next(): number {
		let t = (this.state += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Uniform float in [min, max). */
	float(min: number, max: number): number {
		return min + (max - min) * this.next();
	}

	/** Uniform integer in [min, max]. */
	int(min: number, max: number): number {
		return Math.floor(this.float(min, max + 1));
	}

	chance(probability: number): boolean {
		return this.next() < probability;
	}

	pick<T>(items: readonly T[]): T {
		return items[this.int(0, items.length - 1)];
	}

	/** `count` distinct items from `items`, or all of them when there are fewer. */
	sample<T>(items: readonly T[], count: number): T[] {
		const pool = items.slice();
		const picked: T[] = [];
		while (pool.length > 0 && picked.length < count) {
			picked.push(pool.splice(this.int(0, pool.length - 1), 1)[0]);
		}
		return picked;
	}

	hex(length: number): string {
		let out = '';
		for (let i = 0; i < length; i++) out += this.int(0, 15).toString(16);
		return out;
	}

	/** An address from the ranges reserved for documentation, so the mock never names a real host. */
	ipv4(): string {
		return `${this.pick(['203.0.113', '198.51.100', '192.0.2'])}.${this.int(1, 254)}`;
	}
}
