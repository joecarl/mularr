import { signal } from 'chispa';
import { services } from './container/ServiceContainer';
import { AmuleApiService, type StatsResponse } from './AmuleApiService';

export class StatsService {
	private apiService = services.get(AmuleApiService);

	// Signal publico con los stats
	public stats = signal<StatsResponse | null>(null);

	private prevRequestFinished = true;

	constructor() {
		setTimeout(() => {
			this.startPolling();
		}, 1000);
	}

	private startPolling() {
		// Primera llamada inmediata
		this.poll();
		// Polling cada 4 segundos
		setInterval(() => this.poll(), 4000);
	}

	private async poll() {
		if (!this.prevRequestFinished) {
			return;
		}
		this.prevRequestFinished = false;
		try {
			const data = await this.apiService.getStatus();
			this.stats.set(data);
		} catch (e) {
			console.error('Failed to fetch stats', e);
			// Podríamos setear un estado de error si fuera necesario
		} finally {
			this.prevRequestFinished = true;
		}
	}
}
