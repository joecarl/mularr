import { Router } from 'express';
import { IndexerController } from '../controllers/IndexerController';

export const indexerRoutes = () => {
	const router = Router();
	const controller = new IndexerController();

	router.get('/', controller.handle);
	// Same indexer, scoped to one Sonarr/Radarr extension's provider selection (see IndexerController.resolveUrlExtension)
	router.get('/ext/:extensionId', controller.handle);

	return router;
};
