import { signal } from 'chispa';

type SortDirection = 'asc' | 'desc';

export class LocalPrefsService {
	private readonly PREFIX = 'mularr.prefs.';

	/**
	 * Gets a value from localStorage with an optional default value
	 */
	public get<T>(key: string, defaultValue: T): T {
		const value = localStorage.getItem(this.PREFIX + key);
		if (value === null) {
			return defaultValue;
		}
		try {
			return JSON.parse(value) as T;
		} catch (e) {
			// Fallback for non-JSON strings
			return value as unknown as T;
		}
	}

	/**
	 * Sets a value in localStorage
	 */
	public set<T>(key: string, value: T): void {
		localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
	}

	/**
	 * Theme is a core preference
	 */
	public getTheme(): string {
		return this.get('theme', 'xp');
	}

	public setTheme(theme: string): void {
		this.set('theme', theme);
	}

	/**
	 * Helper for table sorting preferences
	 */
	public getSort<T>(feature: string, defaultCol: T, defaultDir: SortDirection = 'asc') {
		return {
			column: this.get(`${feature}.sort.column`, defaultCol) as T,
			direction: this.get(`${feature}.sort.direction`, defaultDir) as SortDirection,
		};
	}

	public setSort<T>(feature: string, column: T, direction: SortDirection): void {
		this.set(`${feature}.sort.column`, column);
		this.set(`${feature}.sort.direction`, direction);
	}
}
