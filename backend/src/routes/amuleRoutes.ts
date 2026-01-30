import { Router } from 'express';
import { AmuleController } from '../controllers/AmuleController';

export const amuleRoutes = () => {
	const router = Router();
	const controller = new AmuleController();

	router.get('/status', controller.getStatus);
	router.get('/servers', controller.getServers);
	router.get('/transfers', controller.getTransfers);
	router.post('/search', controller.search);
	router.get('/search/results', controller.getSearchResults);
	router.post('/download', controller.download);

	return router;
};
