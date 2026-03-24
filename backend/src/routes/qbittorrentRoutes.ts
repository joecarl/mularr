import { Router } from 'express';
import { QbittorrentController } from '../controllers/QbittorrentController';
import { authMiddleware } from '../middleware/authMiddleware';

export const qbittorrentRoutes = () => {
	const router = Router();
	const controller = new QbittorrentController();

	// Public — Sonarr/Radarr call this without a session to obtain the SID cookie
	router.post('/auth/login', controller.login);

	// App
	router.get('/app/version', controller.getVersion);
	router.get('/app/webapiVersion', controller.getWebApiVersion);
	router.get('/app/preferences', controller.getPreferences);

	// Everything below requires auth
	router.use(authMiddleware);

	// Torrents
	router.get('/torrents/info', controller.getTorrents);
	router.get('/torrents/files', controller.getFiles);
	router.get('/torrents/categories', controller.getCategories);
	router.get('/torrents/properties', controller.getProperties);
	router.post('/torrents/createCategory', controller.createCategory);
	router.post('/torrents/add', controller.addTorrent);
	router.post('/torrents/delete', controller.deleteTorrent);

	return router;
};
