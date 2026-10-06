/**
 * Bridge to the backend's wire-contract types, the single place in the frontend that reaches into
 * the backend tree. Everything from the backend is imported as a type: `import type` is erased by
 * esbuild, so Vite never touches backend code. The backend modules referenced here must stay free of
 * imports, because the Docker frontend stage copies backend/src/types without backend/node_modules.
 *
 * The only runtime content is the frontend counterpart of contract enums (see CHUNK_STATUS below),
 * which can't cross as a type and is checked against the backend definition instead.
 *
 * Consumers don't import from here directly: MediaApiService, DashboardApiService and AuthApiService
 * re-export these for the rest of the UI.
 */
import type { CHUNK_STATUS as ChunkStatus } from '../../../backend/src/types/MediaTypes';

export type { ChunkStatus };
export type {
	ChunkInfo,
	TransferSource,
	TransferSourceNameCount,
	MediaCategory,
	MediaTransfer,
	MediaTransfersResponse,
	MediaSearchResult,
	MediaSearchResponse,
	MediaSearchStatusResponse,
	SearchProviderId,
} from '../../../backend/src/types/MediaTypes';
export type { SpeedSample } from '../../../backend/src/types/StatsTypes';
export type {
	IndexerFeedMediaType,
	IndexerFeedItem,
	IndexerFeedListResponse,
	ArrSyncExtensionStatus,
	ArrSyncStatusResponse,
	WantedItem,
	WantedListResponse,
	ProviderFeedSource,
	ProviderFeedStatus,
	ProviderFeedStatusResponse,
} from '../../../backend/src/types/IndexerFeedTypes';
export type { AuthStatus } from '../../../backend/src/types/AuthTypes';

/**
 * Runtime counterpart of the backend's CHUNK_STATUS enum, which only reaches the frontend as a type.
 * `satisfies` checks it member by member, so it fails to compile if the enum changes.
 */
export const CHUNK_STATUS = { UNAVAILABLE: 0, AVAILABLE: 1, COMPLETE: 2, DOWNLOADING: 3 } as const satisfies {
	[K in keyof typeof ChunkStatus]: (typeof ChunkStatus)[K];
};
