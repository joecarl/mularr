import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { SystemService } from '../services/SystemService';

export class SystemController {
	private systemService = container.get(SystemService);

	public getSystemInfo = async (req: Request, res: Response) => {
		try {
			const info = await this.systemService.getSystemInfo();
			res.json(info);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
