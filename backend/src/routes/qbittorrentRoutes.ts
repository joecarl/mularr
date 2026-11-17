import { Router } from 'express';
import { QbittorrentController } from '../controllers/QbittorrentController';
import { qbittorrentAuthMiddleware } from '../middleware/authMiddleware';

export const qbittorrentRoutes = () => {
	const router = Router();
	const controller = new QbittorrentController();

	// Public — Sonarr/Radarr call this without a session to obtain the SID cookie
	router.post('/auth/login', controller.login);

	// Public — kept unauthenticated so the *arr API-version probe works before login
	router.get('/app/version', controller.getVersion);
	router.get('/app/webapiVersion', controller.getWebApiVersion);

	// Everything below requires auth. Rejections are 403, as in qBittorrent, so Sonarr/Radarr
	// log in again when their session expires instead of failing until restarted.
	router.use(qbittorrentAuthMiddleware);

	// App — preferences expose the save/temp paths on disk, so they stay behind auth
	router.get('/app/preferences', controller.getPreferences);

	// Torrents
	router.get('/torrents/info', controller.getTorrents);
	router.get('/torrents/files', controller.getFiles);
	router.get('/torrents/categories', controller.getCategories);
	router.get('/torrents/properties', controller.getProperties);
	router.post('/torrents/createCategory', controller.createCategory);
	router.post('/torrents/setCategory', controller.setCategory);
	router.post('/torrents/setShareLimits', controller.setShareLimits);
	router.post('/torrents/add', controller.addTorrent);
	router.post('/torrents/delete', controller.deleteTorrent);

	return router;
};
