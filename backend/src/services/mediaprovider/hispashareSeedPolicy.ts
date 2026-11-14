import { __APP_CONFIG__ } from '../../app-env';
import { container } from '../container/ServiceContainer';
import { MainDB } from '../db/MainDB';
import { LoggerFactory } from '../logging/Logger';
import { HISPASHARE_PROVIDER_ID } from './adapters/HispashareMediaProvider';
import type { MediaSearchResult } from '../../types/MediaTypes';

const logger = LoggerFactory.create('HispashareSeedPolicy');

/**
 * Keep a Hispashare download sharing after completion by storing the no-limit sentinel (-1/-1) as its seed
 * limits, when the download's stored search_result says it came from Hispashare and keepSharing is on.
 * Sonarr/Radarr read -1 as "no limit of that kind", so they never remove the download (and its file).
 */
export function applyHispashareSeedPolicy(hash: string): boolean {
	if (!__APP_CONFIG__.hispashare.keepSharing) return false;
	const key = hash.toLowerCase();
	const db = container.get(MainDB);
	const record = db.getDownload(key);
	if (!record?.search_result) return false;

	let provider: string | undefined;
	try {
		provider = (JSON.parse(record.search_result) as Partial<MediaSearchResult>).provider;
	} catch {
		return false;
	}
	if (provider !== HISPASHARE_PROVIDER_ID) return false;

	db.setDownloadSeedLimits(key, -1, -1);
	logger.info(`Hispashare download ${key} keeps sharing: no seed limits`);
	return true;
}
