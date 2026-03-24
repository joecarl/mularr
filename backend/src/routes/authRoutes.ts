import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';

export const authRoutes = () => {
	const router = Router();
	const controller = new AuthController();

	// All auth routes are public by design — no authMiddleware applied
	router.get('/status', controller.getStatus);
	router.post('/login', controller.login);

	return router;
};
