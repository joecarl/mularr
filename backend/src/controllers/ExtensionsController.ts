import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { ExtensionsService } from '../services/ExtensionsService';

export class ExtensionsController {
	private readonly service: ExtensionsService;

	constructor() {
		this.service = container.get(ExtensionsService);
	}

	list = (req: Request, res: Response) => {
		try {
			const extensions = this.service.getAllExtensions();
			res.json(extensions);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	add = (req: Request, res: Response) => {
		try {
			const { name, url, type, enabled } = req.body;
			this.service.addExtension({ name, url, type, enabled: enabled ? 1 : 0 });
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	delete = (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			this.service.deleteExtension(Number(id));
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	toggle = (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			const { enabled } = req.body;
			this.service.toggleExtension(Number(id), enabled);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
