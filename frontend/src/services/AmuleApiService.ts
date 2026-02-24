import { BaseApiService } from './BaseApiService';

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
	maxConnectionsPerFiveSeconds?: string;
	slotAllocation?: string;
	queueSizePref?: string;
	fileBufferSizePref?: string;
	downloadCap?: string;
	uploadCap?: string;
	maxUpload?: string;
	maxDownload?: string;
	incomingDir?: string;
	tempDir?: string;
	ed2k?: boolean;
	kad?: boolean;
	autoconnect?: boolean;
	reconnect?: boolean;
	upnp?: boolean;
	obfuscationRequested?: boolean;
	obfuscationRequired?: boolean;
	smartIdCheck?: boolean;
	ich?: boolean;
	allocateFullFile?: boolean;
	lockedFields?: {
		incomingDir?: boolean;
		tempDir?: boolean;
		ports?: boolean;
	};
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

export interface Transfer extends AmuleFile {
	completed?: number;
	speed?: number;
	progress?: number;
	sources?: number;
	priority?: number;
	status?: string;
	statusId?: number;
	stopped?: boolean;
	remaining?: number;
	categoryName?: string;
	addedOn?: number;
	isCompleted?: boolean;
	provider?: string;
}

export interface AmuleUpDownClient {
	clientName?: string;
	userHashHexString?: string;
	userID?: number;
	score?: number;
	software?: string;
	softVerStr?: string;
	userIP?: string;
	userPort?: number;
	sourceFrom?: number;
	serverIP?: string;
	serverPort?: number;
	serverName?: string;
	upSpeed?: number;
	downSpeed?: number;
	uploadSession?: number;
	transferredDown?: number;
	uploadedTotal?: number;
	downloadedTotal?: number;
	uploadState?: number;
	downloadState?: number;
	identState?: number;
	extProtocol?: number;
	waitingPosition?: number;
	remoteQueueRank?: number;
	oldRemoteQueueRank?: number;
	obfuscationStatus?: number;
	kadPort?: number;
	friendSlot?: number;
	uploadFileId?: bigint | number;
	uploadFilename?: string;
	requestFileId?: bigint | number;
	remoteFilename?: string;
	disableViewShared: boolean;
	version?: number;
	modVersion?: string;
	osInfo?: string;
	availableParts?: number;
	partStatus?: string;
	nextRequestedPart?: number;
	lastDownloadingPart?: number;
	uploadPartStatus?: string;
}

export interface UploadQueueResponse {
	raw?: string;
	list: AmuleUpDownClient[];
}

export interface Category {
	id: number;
	name: string;
	path: string;
	comment: string;
	color: number;
	priority: number;
	/** Effective directory on disk: category.path if set, otherwise aMule's global IncomingDir */
	resolvedPath?: string;
}

export interface TransfersResponse {
	raw: string;
	list: Transfer[];
	categories: Category[];
}

export interface AmuleFile {
	rawLine: string;
	name?: string;
	size?: number;
	hash?: string;

	path?: string;
	fileEd2kLink?: string;
	upPrio: number;
	getRequests: number;
	getAllRequests: number;
	getAccepts: number;
	getAllAccepts: number;
	getXferred: number;
	getAllXferred: number;
	getCompleteSourcesLow: number;
	getCompleteSourcesHigh: number;
	getCompleteSources: number;
	getOnQueue: number;
	getComment?: string;
	getRating?: number;
}

export interface SharedResponse {
	raw: string;
	list: AmuleFile[];
}

export interface SearchResult {
	name: string;
	size: number;
	hash: string;
	type?: string;
	sources?: string;
	downloadStatus?: number;
	completeSources?: string;
	provider?: string;
}

export interface SearchResultsResponse {
	raw: string;
	list: SearchResult[];
}

export interface SearchStatusResponse {
	raw: string;
	progress: number;
}

export interface UpdateResponse {
	sharedFiles: AmuleFile[];
	//downloadQueue: AmuledTransferringFile[];
	clients: AmuleUpDownClient[];
	//servers: AmuleServer[];
	//friends: AmuleFriend[];
}

export interface SuccessResponse {
	success: boolean;
}

export class AmuleApiService extends BaseApiService {
	constructor() {
		super('/api/amule');
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

	async updateConfig(config: ConfigValues): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>('/config', {
			method: 'POST',
			body: JSON.stringify(config),
		});
	}

	async getServers(): Promise<ServersResponse> {
		return this.request<ServersResponse>('/servers');
	}

	async getTransfers(): Promise<TransfersResponse> {
		return this.request<TransfersResponse>('/transfers');
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/transfers/clear-completed', {
			method: 'POST',
			body: JSON.stringify({ hashes }),
		});
	}

	async getSharedFiles(): Promise<SharedResponse> {
		return this.request<SharedResponse>('/shared');
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

	async getSearchStatus(): Promise<SearchStatusResponse> {
		return this.request<SearchStatusResponse>('/search/status');
	}

	async getUploadQueue(): Promise<UploadQueueResponse> {
		return this.request<UploadQueueResponse>('/upload-queue');
	}

	async addDownload(link: string): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/download', {
			method: 'POST',
			body: JSON.stringify({ link }),
		});
	}

	async sendDownloadCommand(hash: string, command: 'pause' | 'resume' | 'stop' | 'cancel'): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/download/command', {
			method: 'POST',
			body: JSON.stringify({ hash, command }),
		});
	}

	async getCategories(): Promise<Category[]> {
		return this.request<Category[]>('/categories');
	}

	async setFileCategory(hash: string, categoryId: number): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/download/set-category', {
			method: 'POST',
			body: JSON.stringify({ hash, categoryId }),
		});
	}

	async connectToServer(ip?: string, port?: number): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/server/connect', {
			method: 'POST',
			body: JSON.stringify({ ip, port }),
		});
	}

	async disconnectFromServer(): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/server/disconnect', {
			method: 'POST',
		});
	}

	async getLog(lines: number = 50): Promise<{ lines: string[] }> {
		return this.request<{ lines: string[] }>(`/log?lines=${lines}`);
	}

	async restartDaemon(): Promise<SuccessResponse> {
		return this.request<SuccessResponse>('/daemon/restart', {
			method: 'POST',
		});
	}

	async getUpdate(): Promise<UpdateResponse> {
		return this.request<UpdateResponse>('/update');
	}
}
