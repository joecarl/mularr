import { signal } from 'chispa';
import { ApiService, StatsResponse } from './ApiService';

export class StatsService {
	private static instance: StatsService;
	private apiService = ApiService.getInstance();

	// Signal publico con los stats
	public stats = signal<StatsResponse | null>(null);

	private constructor() {
		setTimeout(() => {
			this.startPolling();
		}, 1000);
	}

	public static getInstance(): StatsService {
		if (!StatsService.instance) {
			StatsService.instance = new StatsService();
		}
		return StatsService.instance;
	}

	private startPolling() {
		// Primera llamada inmediata
		this.poll();
		// Polling cada 4 segundos
		setInterval(() => this.poll(), 4000);
	}

	private async poll() {
		try {
			const data = await this.apiService.getStatus();
			this.stats.set(data);
		} catch (e) {
			console.error('Failed to fetch stats', e);
			// Podríamos setear un estado de error si fuera necesario
		}
	}
}
