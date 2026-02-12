import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { WebhooksService } from '../services/WebhooksService';

export class WebhooksController {
	private readonly service: WebhooksService;

	constructor() {
		this.service = container.get(WebhooksService);
	}

	list = (req: Request, res: Response) => {
		try {
			const webhooks = this.service.getAllWebhooks();
			res.json(webhooks);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	add = (req: Request, res: Response) => {
		try {
			const { name, url, type, enabled } = req.body;
			this.service.addWebhook({ name, url, type, enabled: enabled ? 1 : 0 });
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	delete = (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			this.service.deleteWebhook(Number(id));
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	toggle = (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			const { enabled } = req.body;
			this.service.toggleWebhook(Number(id), enabled);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
