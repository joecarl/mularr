import { component, inject, refBindCheckbox, refBindInput, signal } from 'chispa';
import {
	ExtensionsApiService,
	HISPASHARE_DEFAULT_API_URL,
	HISPASHARE_FEED_MIN_INTERVAL_MINUTES,
	parseHispashareConfig,
	type HispashareExtensionConfig,
} from '../../../services/ExtensionsApiService';
import type { ConfigFormProps, ConfigFormValues } from './ConfigForm';
import tpl from './HispashareConfigForm.html';

/** Config form for the hispashare extension: API URL, personal token and whether its new releases feed the indexer. */
export const HispashareConfigForm = component<ConfigFormProps>(({ type, extension, handle }) => {
	const api = inject(ExtensionsApiService);
	const stored = parseHispashareConfig(extension?.config);

	const url = signal(extension?.url || HISPASHARE_DEFAULT_API_URL);
	const token = signal(stored.token);
	const feedEnabled = signal(stored.feedEnabled);
	const feedInterval = signal(String(stored.feedIntervalMinutes));

	const read = (): (ConfigFormValues & { config: HispashareExtensionConfig }) | { error: string } => {
		const tokenValue = token.get().trim();
		if (!tokenValue) return { error: 'Token is required' };
		const feedIntervalMinutes = Number(feedInterval.get());
		if (!Number.isInteger(feedIntervalMinutes) || feedIntervalMinutes < HISPASHARE_FEED_MIN_INTERVAL_MINUTES) {
			return { error: `The feed poll interval must be a whole number of at least ${HISPASHARE_FEED_MIN_INTERVAL_MINUTES} minutes` };
		}
		return {
			url: url.get().trim() || HISPASHARE_DEFAULT_API_URL,
			config: { token: tokenValue, feedEnabled: feedEnabled.get(), feedIntervalMinutes },
		};
	};

	handle.read = read;
	handle.test = async () => {
		const values = read();
		if ('error' in values) throw new Error(values.error);
		return (await api.testConnection(type, values.url, values.config)).message;
	};

	return tpl.fragment({
		urlInput: { _ref: refBindInput(url) },
		tokenInput: { _ref: refBindInput(token) },
		feedCheckbox: { _ref: refBindCheckbox(feedEnabled) },
		feedIntervalInput: { _ref: refBindInput(feedInterval), min: String(HISPASHARE_FEED_MIN_INTERVAL_MINUTES), disabled: () => !feedEnabled.get() },
		feedIntervalHint: { inner: `min. ${HISPASHARE_FEED_MIN_INTERVAL_MINUTES}; the API allows 250 requests per hour` },
	});
});
