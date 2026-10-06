import { Router } from 'express';
import { IndexerFeedController } from '../controllers/IndexerFeedController';

export const indexerFeedRoutes = () => {
	const router = Router();
	const controller = new IndexerFeedController();

	router.get('/', controller.list);
	router.delete('/', controller.clear);
	router.get('/wanted', controller.wanted);
	router.get('/sync-status', controller.syncStatus);
	router.post('/sync/:extensionId', controller.runSync);
	router.get('/sources', controller.providerFeeds);
	router.delete('/:hash', controller.remove);

	return router;
};
