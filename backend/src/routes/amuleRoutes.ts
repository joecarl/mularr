import { Router } from 'express';
import { AmuleController } from '../controllers/AmuleController';

export const amuleRoutes = () => {
	const router = Router();
	const controller = new AmuleController();

	router.get('/info', controller.getInfo);
	router.get('/status', controller.getStatus);
	router.get('/config', controller.getConfig);
	router.get('/servers', controller.getServers);
	router.get('/transfers', controller.getTransfers);
	router.post('/search', controller.search);
	router.get('/search/results', controller.getSearchResults);
	router.post('/download', controller.download);
	router.post('/server/connect', controller.connect);
	router.get('/log', controller.getLog);

	return router;
};
