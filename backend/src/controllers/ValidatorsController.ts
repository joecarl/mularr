import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { ValidatorsService } from '../services/ValidatorsService';

export class ValidatorsController {
	private readonly service: ValidatorsService;

	constructor() {
		this.service = container.get(ValidatorsService);
	}

	list = (req: Request, res: Response) => {
		try {
			const validators = this.service.getAllValidators();
			res.json(validators);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	add = (req: Request, res: Response) => {
		try {
			const { name, url, type, enabled } = req.body;
			this.service.addValidator({ name, url, type, enabled: enabled ? 1 : 0 });
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	delete = (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			this.service.deleteValidator(Number(id));
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	toggle = (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			const { enabled } = req.body;
			this.service.toggleValidator(Number(id), enabled);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
