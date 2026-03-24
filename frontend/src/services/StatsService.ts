import { signal, computed } from 'chispa';
import { services } from './container/ServiceContainer';
import { WsService } from './WsService';
import type { StatsResponse } from './AmuleApiService';

export class StatsService {
	private ws = services.get(WsService);

	/** Reactive aMule status – updated via WebSocket. */
	public readonly stats = computed<StatsResponse | null>(() => this.ws.amuleStatus.get());
}
