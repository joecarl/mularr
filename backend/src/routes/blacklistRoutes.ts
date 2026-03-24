import { Router } from 'express';
import { BlacklistController } from '../controllers/BlacklistController';

export const blacklistRoutes = () => {
	const router = Router();
	const controller = new BlacklistController();

	router.get('/', controller.getBlacklist);
	router.get('/:hash', controller.checkBlacklist);
	router.post('/', controller.addToBlacklist);
	router.delete('/:hash', controller.removeFromBlacklist);

	return router;
};
