interface ProviderMeta {
	name: string;
	icon: string;
}

const providersMeta: Record<string, ProviderMeta> = {
	amule: {
		name: 'aMule',
		icon: '🐴',
	},
	telegram: {
		name: 'Telegram',
		icon: '📩',
	},
};

export function getProviderName(provider?: string) {
	if (!provider) return 'Unknown';
	return providersMeta[provider]?.name ?? provider;
}

export function getProviderIcon(provider?: string) {
	if (!provider) return '-';
	return providersMeta[provider]?.icon ?? '❓';
}
