import { Router } from 'express';
import { WebhooksController } from '../controllers/WebhooksController';

export const webhooksRoutes = () => {
	const router = Router();
	const controller = new WebhooksController();

	router.get('/', controller.list);
	router.post('/', controller.add);
	router.delete('/:id', controller.delete);
	router.patch('/:id/toggle', controller.toggle);

	return router;
};
