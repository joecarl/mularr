import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { TelegramIndexerService } from '../services/TelegramIndexerService';

export class TelegramController {
	private get service(): TelegramIndexerService {
		return container.get(TelegramIndexerService);
	}

	getStatus = async (req: Request, res: Response) => {
		try {
			const status = await this.service.getAuthStatus();
			res.json(status);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	startAuth = async (req: Request, res: Response) => {
		try {
			const { apiId, apiHash, phoneNumber } = req.body;
			if (!apiId || !apiHash || !phoneNumber) {
				return res.status(400).json({ error: 'Missing apiId, apiHash or phoneNumber' });
			}
			await this.service.startAuth(parseInt(apiId), apiHash, phoneNumber);
			res.json({ success: true, message: 'Code sent to Telegram app' });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	submitCode = async (req: Request, res: Response) => {
		try {
			const { code } = req.body;
			if (!code) return res.status(400).json({ error: 'Missing code' });

			await this.service.submitCode(code);
			res.json({ success: true });
		} catch (e: any) {
			// Check if it's a 2FA error
			if (e.message.includes('SESSION_PASSWORD_NEEDED')) {
				return res.status(401).json({ error: 'SESSION_PASSWORD_NEEDED', message: '2FA Password required' });
			}
			res.status(500).json({ error: e.message });
		}
	};

	submitPassword = async (req: Request, res: Response) => {
		try {
			const { password } = req.body;
			if (!password) return res.status(400).json({ error: 'Missing password' });

			await this.service.submitPassword(password);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	logout = async (req: Request, res: Response) => {
		try {
			await this.service.logout();
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	getChats = (req: Request, res: Response) => {
		try {
			const chats = this.service.getDiscoveredChats();
			res.json(chats);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};

	updateChatIndexing = (req: Request, res: Response) => {
		try {
			const { chatId } = req.params;
			const { enabled } = req.body;
			// Ensure chatId is string
			const id = Array.isArray(chatId) ? chatId[0] : chatId;
			this.service.setChatIndexing(id, enabled);
			res.json({ success: true });
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	};
}
