import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { SpeedHistoryService } from '../services/SpeedHistoryService';

export class StatsController {
	private get service(): SpeedHistoryService {
		return container.get(SpeedHistoryService);
	}

	/**
	 * GET /api/stats/speed-history
	 *
	 * Query params:
	 *   - limit  (optional) – max number of samples to return (newest first if used)
	 *   - since  (optional) – Unix timestamp ms; only return samples newer than this
	 */
	getSpeedHistory = (req: Request, res: Response) => {
		try {
			let history = this.service.getHistory();

			const since = req.query.since ? Number(req.query.since) : null;
			if (since && !Number.isNaN(since)) {
				history = history.filter((s) => s.ts > since);
			}

			const limit = req.query.limit ? Number(req.query.limit) : null;
			if (limit && !Number.isNaN(limit) && limit > 0) {
				history = history.slice(-limit);
			}

			res.json({ samples: history });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	/**
	 * GET /api/stats/speed-latest
	 * Returns only the most recent speed sample.
	 */
	getLatest = (req: Request, res: Response) => {
		try {
			const latest = this.service.getLatest();
			if (!latest) {
				return res.json({ sample: null });
			}
			res.json({ sample: latest });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
