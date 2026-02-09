import { Router } from 'express';
import { ValidatorsController } from '../controllers/ValidatorsController';

export const validatorsRoutes = () => {
	const router = Router();
	const controller = new ValidatorsController();

	router.get('/', controller.list);
	router.post('/', controller.add);
	router.delete('/:id', controller.delete);
	router.patch('/:id/toggle', controller.toggle);

	return router;
};
