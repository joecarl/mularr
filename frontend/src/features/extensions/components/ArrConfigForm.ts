import { component, inject, refBindCheckbox, refBindInput, signal } from 'chispa';
import {
	ARR_SYNC_MIN_INTERVAL_MINUTES,
	EXTENSION_TYPES,
	ExtensionsApiService,
	parseArrConfig,
	type ArrExtensionConfig,
} from '../../../services/ExtensionsApiService';
import { SEARCH_PROVIDER_IDS, getProviderIcon, getProviderName, type SearchProviderId } from '../../../services/ProvidersApiService';
import { MediaApiService } from '../../../services/MediaApiService';
import type { ConfigFormProps, ConfigFormValues } from './ConfigForm';
import tpl from './ArrConfigForm.html';

/**
 * Config form for the sonarr/radarr extensions: which search providers the instance uses (for its own searches
 * through the indexer and for the wanted sync) and, when the wanted sync is on, the endpoint, API key and how
 * often the wanted list is synced.
 */
export const ArrConfigForm = component<ConfigFormProps>(({ type, extension, handle }) => {
	const api = inject(ExtensionsApiService);
	const stored = parseArrConfig(extension?.config);
	const appName = EXTENSION_TYPES[type]?.label ?? type;

	const syncWanted = signal(stored.syncWanted);
	const url = signal(extension?.url ?? '');
	const apiKey = signal(stored.apiKey);
	const interval = signal(String(stored.intervalMinutes));

	// Providers the sync can use right now; empty until they are loaded. A new extension starts with none
	// checked (the periodic search is opted into per provider); a config saved before the selection existed
	// behaves as "all", so it shows all of them checked.
	const availableProviders = signal<SearchProviderId[]>([]);
	const selectedProviders = new Set<string>(stored.searchProviders ?? []);
	inject(MediaApiService)
		.getSearchProviders()
		.catch(() => [...SEARCH_PROVIDER_IDS])
		.then((ids) => {
			if (extension && stored.searchProviders === undefined) ids.forEach((id) => selectedProviders.add(id));
			availableProviders.set(ids);
		});

	const read = (): (ConfigFormValues & { config: ArrExtensionConfig }) | { error: string } => {
		const sync = syncWanted.get();
		const urlValue = url.get().trim();
		const intervalMinutes = Number(interval.get());
		const intervalValid = Number.isInteger(intervalMinutes) && intervalMinutes >= ARR_SYNC_MIN_INTERVAL_MINUTES;
		// The connection settings only matter while the sync is on; what was typed is kept either way
		if (sync) {
			if (!urlValue) return { error: 'URL is required to sync the wanted list' };
			if (!intervalValid) return { error: `The sync interval must be a whole number of at least ${ARR_SYNC_MIN_INTERVAL_MINUTES} minutes` };
			if (!apiKey.get().trim()) return { error: 'API key is required to sync the wanted list' };
		}
		const config: Record<string, unknown> & ArrExtensionConfig = {
			syncWanted: sync,
			apiKey: apiKey.get().trim(),
			intervalMinutes: intervalValid ? intervalMinutes : stored.intervalMinutes,
		};
		const available = availableProviders.get();
		if (available.length > 0) {
			// Only providers listed can be kept: one whose extension was disabled meanwhile is dropped
			config.searchProviders = available.filter((id) => selectedProviders.has(id));
		} else if (stored.searchProviders !== undefined) {
			config.searchProviders = stored.searchProviders; // list not loaded yet: keep what was stored
		}
		return { url: urlValue, config };
	};

	handle.read = read;
	handle.test = async () => {
		if (!syncWanted.get()) throw new Error('Enable the wanted list sync to test the connection');
		const values = read();
		if ('error' in values) throw new Error(values.error);
		return (await api.testConnection(type, values.url, values.config)).message;
	};

	return tpl.fragment({
		appName: { inner: appName },
		appName2: { inner: appName },
		syncCheckbox: { _ref: refBindCheckbox(syncWanted) },
		syncFields: { style: { display: () => (syncWanted.get() ? '' : 'none') } },
		urlInput: { _ref: refBindInput(url) },
		apiKeyInput: { _ref: refBindInput(apiKey) },
		intervalInput: { _ref: refBindInput(interval), min: String(ARR_SYNC_MIN_INTERVAL_MINUTES) },
		intervalHint: { inner: `min. ${ARR_SYNC_MIN_INTERVAL_MINUTES}; each run performs up to 10 searches` },
		appName3: { inner: appName },
		// Every extension of the app applies to its kind of search: the indexer tells the app from the request, not the instance
		searchKind: {
			inner: type === 'sonarr' ? 'TV searches, together with any other Sonarr extension' : 'movie searches, together with any other Radarr extension',
		},
		providersList: {
			inner: () =>
				availableProviders.get().map((id) =>
					tpl.providerRow({
						nodes: {
							providerCheckbox: {
								checked: selectedProviders.has(id),
								onchange: (e: Event) => {
									if ((e.target as HTMLInputElement).checked) selectedProviders.add(id);
									else selectedProviders.delete(id);
								},
							},
							providerIcon: { inner: getProviderIcon(id) },
							providerName: { inner: getProviderName(id) },
						},
					})
				),
		},
	});
});
