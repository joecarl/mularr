import { component, inject, refBindInput, signal } from 'chispa';
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
 * Config form for the sonarr/radarr extensions: endpoint, API key, how often the wanted list is synced and
 * which search providers it is looked up on.
 */
export const ArrConfigForm = component<ConfigFormProps>(({ type, extension, handle }) => {
	const api = inject(ExtensionsApiService);
	const stored = parseArrConfig(extension?.config);
	const appName = EXTENSION_TYPES[type]?.label ?? type;

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
		const urlValue = url.get().trim();
		if (!urlValue) return { error: 'URL is required' };
		const intervalMinutes = Number(interval.get());
		if (!Number.isInteger(intervalMinutes) || intervalMinutes < ARR_SYNC_MIN_INTERVAL_MINUTES) {
			return { error: `The sync interval must be a whole number of at least ${ARR_SYNC_MIN_INTERVAL_MINUTES} minutes` };
		}
		if (!apiKey.get().trim()) return { error: 'API key is required' };
		const config: Record<string, unknown> & ArrExtensionConfig = { apiKey: apiKey.get().trim(), intervalMinutes };
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
		const values = read();
		if ('error' in values) throw new Error(values.error);
		return (await api.testConnection(type, values.url, values.config)).message;
	};

	return tpl.fragment({
		appName: { inner: appName },
		appName2: { inner: appName },
		urlInput: { _ref: refBindInput(url) },
		apiKeyInput: { _ref: refBindInput(apiKey) },
		intervalInput: { _ref: refBindInput(interval), min: String(ARR_SYNC_MIN_INTERVAL_MINUTES) },
		intervalHint: { inner: `min. ${ARR_SYNC_MIN_INTERVAL_MINUTES}; each run performs up to 10 searches` },
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
