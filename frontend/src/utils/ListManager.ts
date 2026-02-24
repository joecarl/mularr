import { signal, computed, effect, WritableSignal, Signal } from 'chispa';
import { LocalPrefsService } from '../services/LocalPrefsService';

/**
 * Minimal interface consumed by row components — lets them stay decoupled from
 * the full generic ListManager type while still sharing selection logic.
 */
export interface RowSelectionManager {
	selectedHashes: WritableSignal<Set<string>>;
	lastClickedHash: WritableSignal<string | null>;
	handleRowSelection<T extends { hash?: string }>(e: MouseEvent, hash: string, list: T[]): void;
}

export interface MobileSortOption<K extends string> {
	value: string;
	label: string;
	col: K;
	dir: 'asc' | 'desc';
}

export interface ListManagerConfig<T, K extends keyof T & string> {
	/** Default sort column */
	defaultColumn: K;
	defaultDirection?: 'asc' | 'desc';
	/**
	 * Columns whose values should be coerced to Number for comparison.
	 * Useful when the data type is string but the semantic is numeric (e.g. "sources").
	 */
	numericColumns?: K[];
	/**
	 * When this predicate returns true the list is returned as-is (unsorted).
	 * Useful for special raw-line placeholder items in transfers.
	 */
	skipSort?: (list: T[]) => boolean;
	/** Options for the mobile sort <select>. When provided a reactive mobileSortValue signal is wired up. */
	mobileSortOptions?: MobileSortOption<K>[];
	/** When provided, sort preferences are persisted/restored from localStorage. */
	prefs?: { service: LocalPrefsService; key: string };
}

/**
 * Manages the reactive list, sorting and multi-selection state for a table view.
 * All UI decisions remain in the component; this class only handles logic.
 *
 * Usage inside a component function:
 *
 *   const mgr = new ListManager<MyItem, keyof MyItem>({ defaultColumn: 'name', ... });
 *   mgr.items.set(fetchedData);
 *   // bind mgr.sortedItems, mgr.selectedHashes, mgr.sort(), etc. in the template
 */
export class ListManager<T extends { hash?: string }, K extends keyof T & string = keyof T & string> {
	/** Raw (unsorted) item list – set this from the outside. */
	readonly items: WritableSignal<T[]>;

	readonly sortColumn: WritableSignal<K>;
	readonly sortDirection: WritableSignal<'asc' | 'desc'>;
	/** Sorted view of items, recomputed whenever items or sort state change. */
	readonly sortedItems: Signal<T[]>;

	readonly selectedHashes: WritableSignal<Set<string>>;
	readonly lastClickedHash: WritableSignal<string | null>;
	readonly selectionCount: Signal<number>;
	readonly hasSelection: Signal<boolean>;

	/** Bound to the mobile sort <select>. Drives sortColumn/sortDirection via effect. */
	readonly mobileSortValue: WritableSignal<string>;

	constructor(config: ListManagerConfig<T, K>) {
		const { defaultColumn, defaultDirection = 'asc', numericColumns = [], skipSort, mobileSortOptions = [], prefs } = config;

		const initialSort = prefs
			? prefs.service.getSort<K>(prefs.key, defaultColumn, defaultDirection)
			: { column: defaultColumn, direction: defaultDirection };

		this.items = signal<T[]>([]);
		this.sortColumn = signal<K>(initialSort.column);
		this.sortDirection = signal<'asc' | 'desc'>(initialSort.direction);
		this.selectedHashes = signal<Set<string>>(new Set());
		this.lastClickedHash = signal<string | null>(null);
		this.selectionCount = computed(() => this.selectedHashes.get().size);
		this.hasSelection = computed(() => this.selectedHashes.get().size > 0);

		this.sortedItems = computed(() => {
			const list = [...this.items.get()];
			if (list.length === 0 || (skipSort && skipSort(list))) return list;

			const col = this.sortColumn.get();
			const dir = this.sortDirection.get();

			list.sort((a, b) => {
				const va = a[col];
				const vb = b[col];

				if (va == null && vb == null) return 0;
				if (va == null) return 1;
				if (vb == null) return -1;

				if (numericColumns.includes(col)) {
					const na = Number(va);
					const nb = Number(vb);
					if (!isNaN(na) && !isNaN(nb)) return dir === 'asc' ? na - nb : nb - na;
				}

				if (va < vb) return dir === 'asc' ? -1 : 1;
				if (va > vb) return dir === 'asc' ? 1 : -1;
				return 0;
			});

			return list;
		});

		// Mobile sort select: apply changes to the active sort signals
		this.mobileSortValue = signal(mobileSortOptions.find((o) => o.col === initialSort.column && o.dir === initialSort.direction)?.value ?? '');
		if (mobileSortOptions.length > 0) {
			effect(() => {
				const opt = mobileSortOptions.find((o) => o.value === this.mobileSortValue.get());
				if (opt) {
					this.sortColumn.set(opt.col);
					this.sortDirection.set(opt.dir);
				}
			});
		}

		// Persist sort state
		if (prefs) {
			effect(() => {
				prefs.service.setSort(prefs.key, this.sortColumn.get(), this.sortDirection.get());
			});
		}
	}

	/** Toggle sort column / direction, matching the standard header-click behaviour. */
	sort(col: K): void {
		if (this.sortColumn.get() === col) {
			this.sortDirection.set(this.sortDirection.get() === 'asc' ? 'desc' : 'asc');
		} else {
			this.sortColumn.set(col);
			this.sortDirection.set('asc');
		}
	}

	clearSelection(): void {
		this.selectedHashes.set(new Set());
	}

	/**
	 * Multi-selection click handler for table rows.
	 * - Normal click → select only this row
	 * - Ctrl/Cmd+click → toggle individual row
	 * - Shift+click → range selection (Ctrl/Cmd+Shift extends current selection)
	 */
	handleRowSelection<TItem extends { hash?: string }>(e: MouseEvent, hash: string, list: TItem[]): void {
		const current = this.selectedHashes.get();

		if (e.shiftKey && this.lastClickedHash.get()) {
			const anchorIdx = list.findIndex((x) => x.hash === this.lastClickedHash.get());
			const targetIdx = list.findIndex((x) => x.hash === hash);
			if (anchorIdx !== -1 && targetIdx !== -1) {
				const lo = Math.min(anchorIdx, targetIdx);
				const hi = Math.max(anchorIdx, targetIdx);
				const next = e.ctrlKey || e.metaKey ? new Set(current) : new Set<string>();
				for (let k = lo; k <= hi; k++) {
					const h = list[k].hash;
					if (h) next.add(h);
				}
				this.selectedHashes.set(next);
			}
		} else if (e.ctrlKey || e.metaKey) {
			const next = new Set(current);
			if (next.has(hash)) {
				next.delete(hash);
			} else {
				next.add(hash);
			}
			this.selectedHashes.set(next);
			this.lastClickedHash.set(hash);
		} else {
			this.selectedHashes.set(new Set([hash]));
			this.lastClickedHash.set(hash);
		}
	}
}
