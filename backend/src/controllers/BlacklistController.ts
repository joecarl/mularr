import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { MainDB } from '../services/db/MainDB';

export class BlacklistController {
	private readonly db = container.get(MainDB);

	getBlacklist = async (_req: Request, res: Response) => {
		try {
			const list = this.db.getBlacklist();
			res.json(list);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	checkBlacklist = async (req: Request, res: Response) => {
		try {
			const hash = req.params.hash as string;
			const entry = this.db.getBlacklistEntry(hash);
			res.json({ blacklisted: !!entry, entry: entry ?? null });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	addToBlacklist = async (req: Request, res: Response) => {
		try {
			const { hash, name, reason } = req.body;
			if (!hash) {
				res.status(400).json({ error: 'hash is required' });
				return;
			}
			this.db.addToBlacklist(hash, name ?? '', reason ?? null);
			res.status(201).json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	removeFromBlacklist = async (req: Request, res: Response) => {
		try {
			const hash = req.params.hash as string;
			this.db.removeFromBlacklist(hash);
			res.status(204).end();
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
