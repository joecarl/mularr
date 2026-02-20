import { Router } from 'express';
import { MediaProviderController } from '../controllers/MediaProviderController';

export const mediaProviderRoutes = () => {
	const router = Router();
	const controller = new MediaProviderController();

	router.get('/transfers', controller.getTransfers);
	router.post('/transfers/clear-completed', controller.clearCompletedTransfers);
	router.post('/search', controller.startSearch);
	router.get('/search/results', controller.getSearchResults);
	router.get('/search/status', controller.getSearchStatus);
	router.post('/download', controller.addDownload);
	router.post('/download/command', controller.downloadCommand);
	router.get('/categories', controller.getCategories);
	router.post('/download/set-category', controller.setFileCategory);

	return router;
};
