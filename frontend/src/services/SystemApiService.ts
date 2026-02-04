import { BaseApiService } from './BaseApiService';

export interface SystemInfo {
	vpn: {
		enabled: boolean;
		status?: string;
		port?: number;
		[key: string]: any;
	};
	publicIp?: string;
	ipDetails?: {
		city?: string;
		region?: string;
		country?: string;
		loc?: string;
		org?: string;
		timezone?: string;
	};
}

export class SystemApiService extends BaseApiService {
	constructor() {
		super('/api/system');
	}

	public async getSystemInfo(): Promise<SystemInfo> {
		return this.request<SystemInfo>('/info');
	}
}
