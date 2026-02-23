import { BaseApiService } from './BaseApiService';

export interface SpeedSample {
	ts: number;
	dlAmule: number;
	dlTelegram: number;
	dlTotal: number;
	ulAmule: number;
	activeAmule: number;
	activeTelegram: number;
}

export interface SpeedHistoryResponse {
	samples: SpeedSample[];
}

export class DashboardApiService extends BaseApiService {
	constructor() {
		super('/api/stats');
	}

	/**
	 * Fetch the full speed-history buffer (or only samples newer than `since` ms timestamp).
	 */
	async getSpeedHistory(since?: number): Promise<SpeedHistoryResponse> {
		const qs = since != null ? `?since=${since}` : '';
		return this.request<SpeedHistoryResponse>(`/speed-history${qs}`);
	}
}
