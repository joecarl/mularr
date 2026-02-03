import { Router } from 'express';
import { ArrController } from '../controllers/ArrController';

export const arrRoutes = () => {
	const router = Router();
	const controller = new ArrController();

	// Auth
	router.post('/auth/login', controller.login);

	// App
	router.get('/app/version', controller.getVersion);
	router.get('/app/webapiVersion', controller.getWebApiVersion);
	router.get('/app/preferences', controller.getPreferences);

	// Torrents
	router.get('/torrents/info', controller.getTorrents);
	router.post('/torrents/add', controller.addTorrent);
	router.post('/torrents/delete', controller.deleteTorrent);

	return router;
};
