import { component, componentList, computed, signal, Signal } from 'chispa';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { MediaApiService, MediaSearchResult } from '../../services/MediaApiService';
import tpl from './SearchTabs.html';
import './SearchTabs.css';

/** A search shown as a tab: the backend keeps its results under `id`, the tab keeps what it read of them. */
export interface SearchTab {
	id: string;
	query: string;
	type: string;
	results: MediaSearchResult[];
	progress: number;
	queued: boolean;
	/** The search reported complete; its results are final and no longer polled. */
	done: boolean;
	blacklistedCount: number;
	status: string;
}

/** What survives navigation and reloads, per browser (see LocalPrefsService). */
type StoredTab = Pick<SearchTab, 'id' | 'query' | 'type'>;

const POLL_MS = 1000;
const TAB_LABEL_MAX_CHARS = 24;

export interface SearchTabsOptions {
	api: MediaApiService;
	prefs: LocalPrefsService;
	/** The active tab's results, whenever they change or another tab becomes active: what the results table shows. */
	showResults: (results: MediaSearchResult[]) => void;
	/** Another tab became active (or none is). */
	onSwitch?: () => void;
}

/**
 * The searches open in the Search view, one tab each, polled on their own. The backend keeps each search's
 * results by id, so searches started from other tabs or sessions never replace these. Open tabs are
 * remembered per browser; the backend answers 404 once it no longer keeps a search (it keeps the last 20,
 * none across a restart), which just closes the tab.
 */
export class SearchTabsManager {
	readonly tabs = signal<SearchTab[]>([]);
	readonly activeTabId = signal<string | null>(null);
	readonly activeTab = computed(() => this.tabs.get().find((t) => t.id === this.activeTabId.get()) ?? null);

	private intervalId: ReturnType<typeof setInterval> | null = null;
	private ticking = false;

	constructor(private readonly opts: SearchTabsOptions) {
		const stored = opts.prefs.get<StoredTab[]>('search.tabs', []);
		const storedActive = opts.prefs.get<string | null>('search.activeTab', null);
		this.tabs.set(stored.map((t) => ({ ...t, results: [], progress: 0, queued: false, done: false, blacklistedCount: 0, status: 'Loading results...' })));
		this.activeTabId.set(stored.some((t) => t.id === storedActive) ? storedActive : (stored[0]?.id ?? null));
		// Pick up the tabs open before navigating away: their status tells which are finished
		if (stored.length > 0) this.startPolling();
	}

	/** Starts a search and opens it as the active tab. Throws what the API throws. */
	async start(query: string, type: string): Promise<void> {
		const { searchId } = await this.opts.api.search(query, type);
		const tab: SearchTab = {
			id: searchId,
			query,
			type,
			results: [],
			progress: 0,
			queued: false,
			done: false,
			blacklistedCount: 0,
			status: 'Search started. Waiting for results...',
		};
		this.tabs.set([...this.tabs.get(), tab]);
		this.activate(tab.id);
	}

	activate(id: string | null): void {
		this.activeTabId.set(id);
		const tab = this.tabs.get().find((t) => t.id === id);
		this.opts.showResults(tab?.results ?? []);
		this.opts.onSwitch?.();
		this.persist();
		// A finished search is not polled any more: refresh once so the download states are current
		if (tab?.done) void this.loadResults(tab.id);
		else if (tab) this.startPolling();
	}

	close(id: string): void {
		const list = this.tabs.get();
		const index = list.findIndex((t) => t.id === id);
		if (index < 0) return;
		const remaining = list.filter((t) => t.id !== id);
		this.tabs.set(remaining);
		if (this.activeTabId.get() === id) this.activate(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
		else this.persist();
	}

	/** Reads a tab's results into it; the active tab's by default (e.g. after adding a download). */
	async loadResults(id: string | null = this.activeTabId.get()): Promise<void> {
		if (!id) return;
		try {
			const data = await this.opts.api.getSearchResults(id);
			const tab = this.tabs.get().find((t) => t.id === id);
			if (!tab) return;
			const n = data.list?.length ?? 0;
			const status = n > 0 ? `Found ${n} results.` : tab.done ? 'No results found.' : 'No results found yet or search is still in progress.';
			this.update(id, { results: data.list ?? [], blacklistedCount: data.blacklistedCount ?? 0, status });
		} catch (e: any) {
			if (isGone(e)) this.close(id);
			else this.update(id, { status: 'Error loading results: ' + e.message });
		}
	}

	/** Stops polling; call when the view unmounts. */
	dispose(): void {
		this.stopPolling();
	}

	// ---- Internals --------------------------------------------------------------

	private persist(): void {
		this.opts.prefs.set(
			'search.tabs',
			this.tabs.get().map(({ id, query, type }): StoredTab => ({ id, query, type }))
		);
		this.opts.prefs.set('search.activeTab', this.activeTabId.get());
	}

	/** Applies a change to one tab; the results shown follow when it is the active one. */
	private update(id: string, patch: Partial<SearchTab>): void {
		this.tabs.set(this.tabs.get().map((t) => (t.id === id ? { ...t, ...patch } : t)));
		if (patch.results && id === this.activeTabId.get()) this.opts.showResults(patch.results);
	}

	/** Reads a tab's search status into it; false when the search is gone (the tab is closed). */
	private async loadStatus(id: string): Promise<boolean> {
		try {
			const status = await this.opts.api.getSearchStatus(id);
			const patch: Partial<SearchTab> = { progress: status.progress, queued: !!status.queued, done: status.progress >= 1 };
			if (status.queued) patch.status = 'Waiting for an earlier search to finish...';
			this.update(id, patch);
			return true;
		} catch (e: any) {
			if (isGone(e)) this.close(id);
			return false;
		}
	}

	// Polling: every second, the status of every unfinished tab and the results of the active one. A tab
	// that just finished loads its results once more (its count shows in the label), then rests.
	private async tick(): Promise<void> {
		if (this.ticking) return;
		this.ticking = true;
		try {
			for (const tab of this.tabs.get().filter((t) => !t.done)) {
				if (!(await this.loadStatus(tab.id))) continue;
				const now = this.tabs.get().find((t) => t.id === tab.id);
				if (now && (now.done || tab.id === this.activeTabId.get())) await this.loadResults(tab.id);
			}
			if (this.tabs.get().every((t) => t.done)) this.stopPolling();
		} finally {
			this.ticking = false;
		}
	}

	private startPolling(): void {
		if (this.intervalId) return;
		this.intervalId = setInterval(() => void this.tick(), POLL_MS);
	}

	private stopPolling(): void {
		if (this.intervalId) clearInterval(this.intervalId);
		this.intervalId = null;
	}
}

const isGone = (e: any) => e?.status === 404;

// ---- Tab bar ------------------------------------------------------------------

interface TabsProps {
	activeTabId: Signal<string | null>;
	onActivate: (id: string) => void;
	onClose: (id: string) => void;
}
const Tabs = componentList<SearchTab, TabsProps>(
	(tab, i, l, props) => {
		const { activeTabId, onActivate, onClose } = props!;
		const label = computed(() => {
			const t = tab.get();
			const text = t.query.length > TAB_LABEL_MAX_CHARS ? t.query.slice(0, TAB_LABEL_MAX_CHARS - 1) + '…' : t.query;
			if (t.queued) return `${text} ⏳`;
			if (!t.done) return `${text} …`;
			return `${text} (${t.results.length})`;
		});
		return tpl.tabItem({
			classes: { active: () => activeTabId.get() === tab.get().id },
			title: () => `${tab.get().query} · ${tab.get().type}`,
			onclick: () => onActivate(tab.get().id),
			nodes: {
				tabLabel: { inner: label },
				tabClose: {
					onclick: (e: MouseEvent) => {
						e.stopPropagation();
						onClose(tab.get().id);
					},
				},
			},
		});
	},
	(t) => t.id
);

export interface SearchTabsBarProps {
	tabs: SearchTabsManager;
}

/** The row of tabs above the results; hidden while no search is open. */
export const SearchTabsBar = component<SearchTabsBarProps>(({ tabs }) => {
	return tpl.fragment({
		tabsBar: {
			style: { display: () => (tabs.tabs.get().length > 0 ? '' : 'none') },
		},
		tabsContainer: {
			inner: Tabs(tabs.tabs, { activeTabId: tabs.activeTabId, onActivate: (id) => tabs.activate(id), onClose: (id) => tabs.close(id) }),
		},
	});
});
