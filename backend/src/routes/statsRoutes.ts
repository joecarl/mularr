import { Router } from 'express';
import { StatsController } from '../controllers/StatsController';

export const statsRoutes = () => {
	const router = Router();
	const controller = new StatsController();

	router.get('/speed-history', controller.getSpeedHistory);
	router.get('/speed-latest', controller.getLatest);

	return router;
};
