export interface StatsResponse {
	raw?: string;
	id?: number;
	ed2kId?: number;
	kadId?: string;
	connectedServer?: {
		name?: string;
		description?: string;
		ip: string;
		port: number;
	};
	connectionState?: any;
	uploadOverhead?: number;
	downloadOverhead?: number;
	bannedCount?: number;
	loggerMessage?: string[];
	totalSentBytes?: number;
	totalReceivedBytes?: number;
	sharedFileCount?: number;
	uploadSpeed?: number;
	downloadSpeed?: number;
	uploadSpeedLimit?: number;
	downloadSpeedLimit?: number;
	uploadQueueLength?: number;
	totalSourceCount?: number;
	ed2kUsers?: number;
	kadUsers?: number;
	ed2kFiles?: number;
	kadFiles?: number;
	kadNodes?: number;
	isHighID?: boolean;
	[key: string]: any;
}

export interface AmuleInfo {
	version: string;
}

export interface ConfigValues {
	nick?: string;
	tcpPort?: string;
	udpPort?: string;
	maxSources?: string;
	maxConnections?: string;
	downloadCap?: string;
	uploadCap?: string;
	incomingDir?: string;
	tempDir?: string;
}

export interface Server {
	ip: string;
	port: number;
	name?: string;
	description?: string;
	ping?: number;
	users?: number;
	maxUsers?: number;
	files?: number;
	priority?: number;
	failedCount?: number;
	isStatic?: boolean;
	softFileLimit?: number;
	lowID?: boolean;
	obfuscated?: boolean;
}

export interface ServersResponse {
	raw?: string;
	list: Server[];
	connectedServer?: {
		ip: string;
		port: number;
		name?: string;
		description?: string;
	};
}

export interface Transfer {
	rawLine: string;
	name?: string;
	size?: number;
	completed?: number;
	speed?: number;
	progress?: number;
	sources?: number;
	priority?: number;
	status?: string;
	remaining?: number;
	hash?: string;
	addedOn?: number; // Placeholder, might be missing from backend
}

export interface TransfersResponse {
	raw: string;
	list: Transfer[];
}

export interface SearchResult {
	name: string;
	size: string;
	link: string;
	type?: string;
	sources?: string;
	completeSources?: string;
}

export interface SearchResultsResponse {
	raw: string;
	list: SearchResult[];
}

export interface SuccessResponse {
	success: boolean;
}

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

export class ApiService {
	private static instance: ApiService;
	private baseUrl = '/api';

	private constructor() {}

	public static getInstance(): ApiService {
		if (!ApiService.instance) {
			ApiService.instance = new ApiService();
		}
		return ApiService.instance;
	}

	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			...options,
			headers: {
				'Content-Type': 'application/json',
				...options.headers,
			},
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ error: 'Unknown error' }));
			throw new Error(error.error || `Request failed with status ${response.status}`);
		}

		if (response.status === 204) {
			return undefined as any;
		}

		const contentType = response.headers.get('content-type');
		if (contentType && contentType.includes('application/json')) {
			return response.json().catch(() => undefined as any);
		}

		return response.text() as any;
	}

	public async getSystemInfo(): Promise<SystemInfo> {
		return this.request<SystemInfo>('/system/info');
	}

	async getInfo(): Promise<AmuleInfo> {
		return this.request<AmuleInfo>('/info');
	}

	async getStatus(): Promise<StatsResponse> {
		return this.request<StatsResponse>('/status');
	}

	async getConfig(): Promise<ConfigValues> {
		return this.request<ConfigValues>('/config');
	}

	async getServers(): Promise<ServersResponse> {
		return this.request<ServersResponse>('/servers');
	}

	async getTransfers(): Promise<TransfersResponse> {
		return this.request<TransfersResponse>('/transfers');
	}

	async search(query: string, type: string): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/search', {
			method: 'POST',
			body: JSON.stringify({ query, type }),
		});
	}

	async getSearchResults(): Promise<SearchResultsResponse> {
		return this.request<SearchResultsResponse>('/search/results');
	}

	async addDownload(link: string): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/download', {
			method: 'POST',
			body: JSON.stringify({ link }),
		});
	}

	async connectToServer(ip: string, port: number): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/server/connect', {
			method: 'POST',
			body: JSON.stringify({ ip, port }),
		});
	}

	async getLog(lines: number = 50): Promise<{ lines: string[] }> {
		return this.request<{ lines: string[] }>(`/log?lines=${lines}`);
	}
}
