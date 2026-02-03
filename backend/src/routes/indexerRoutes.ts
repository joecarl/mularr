import { Router } from 'express';
import { IndexerController } from '../controllers/IndexerController';

export const indexerRoutes = () => {
	const router = Router();
	const controller = new IndexerController();

	router.get('/', controller.handle);

	return router;
};
