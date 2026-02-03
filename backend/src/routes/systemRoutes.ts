import { Router } from 'express';
import { SystemController } from '../controllers/SystemController';

export const systemRoutes = (): Router => {
	const router = Router();
	const controller = new SystemController();

	router.get('/info', controller.getSystemInfo);

	return router;
};
