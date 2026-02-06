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
	router.get('/shared', controller.getSharedFiles);
	router.post('/search', controller.search);
	router.get('/search/results', controller.getSearchResults);
	router.get('/search/status', controller.getSearchStatus);
	router.post('/download', controller.download);
	router.post('/download/command', controller.downloadCommand);
	router.get('/categories', controller.getCategories);
	router.post('/categories', controller.createCategory);
	router.put('/categories/:id', controller.updateCategory);
	router.delete('/categories/:id', controller.deleteCategory);
	router.post('/download/set-category', controller.setFileCategory);
	router.post('/server/connect', controller.connect);
	router.get('/log', controller.getLog);

	return router;
};
