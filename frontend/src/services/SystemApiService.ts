import { BaseApiService } from './BaseApiService';
import type { DiskDir, DiskRole, DiskSpace } from './apiTypes';

// Wire contract owned by the backend (see apiTypes.ts)
export type { DiskDir, DiskRole, DiskSpace };

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
	/** Filesystems behind the incoming and temp directories; empty when neither could be read. */
	disks: DiskSpace[];
}

export class SystemApiService extends BaseApiService {
	constructor() {
		super('/api/system');
	}

	public async getSystemInfo(): Promise<SystemInfo> {
		return this.request<SystemInfo>('/info');
	}
}
