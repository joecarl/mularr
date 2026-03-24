import { Request, Response } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AuthService } from '../services/AuthService';

export class AuthController {
	private get authService() {
		return container.get(AuthService);
	}

	getStatus = (_req: Request, res: Response) => {
		res.json(this.authService.getStatus());
	};

	login = (req: Request, res: Response) => {
		const { username, password } = req.body;
		if (typeof username !== 'string' || typeof password !== 'string') {
			res.status(400).json({ error: 'username and password are required' });
			return;
		}
		if (!this.authService.validateCredentials(username, password)) {
			res.status(401).json({ error: 'Invalid credentials' });
			return;
		}
		const token = this.authService.generateToken(username);
		res.json({ token });
	};
}
