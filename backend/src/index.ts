import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';

import { container } from './ServiceContainer';
import { AmuleService } from './services/AmuleService';
import { TelegramService } from './services/TelegramService';
import { GluetunService } from './services/GluetunService';
import { AmuledService } from './services/AmuledService';
import { SystemService } from './services/SystemService';
import { amuleRoutes } from './routes/amuleRoutes';
import { systemRoutes } from './routes/systemRoutes';

const app = express();
const port = process.env.PORT || 8940;

app.use(cors());
app.use(express.json());

// -- Initialize & register services in container ------------------------------

// Initialize Amule Service
const amuleService = new AmuleService();
container.register(AmuleService, amuleService);

const amuledService = new AmuledService();
container.register(AmuledService, amuledService);

// Initialize Gluetun Service
const gluetunService = new GluetunService();
container.register(GluetunService, gluetunService);
gluetunService.start();

// Initialize System Service
const systemService = new SystemService();
container.register(SystemService, systemService);

// Initialize Telegram Service (Optional)
if (process.env.TELEGRAM_BOT_TOKEN) {
	const topicId = process.env.TELEGRAM_TOPIC_ID ? parseInt(process.env.TELEGRAM_TOPIC_ID) : undefined;
	const tgService = new TelegramService(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID!, topicId);
	container.register(TelegramService, tgService);
}

// -- Setup routes -------------------------------------------------------------

app.use('/api/system', systemRoutes());
app.use('/api', amuleRoutes());

// -- Serve static files from the 'public' folder ------------------------------

const publicPath = path.join(__dirname, '../public');
// If public folder exists, serve it
app.use(express.static(publicPath));

// -- Handle SPA routing: serve index.html for any unknown routes (that don't start with /api)
app.get(/.*/, (req, res, next) => {
	if (req.path.startsWith('/api')) {
		return next();
	}
	res.sendFile(path.join(publicPath, 'index.html'), (err) => {
		if (err) {
			res.status(200).send('Mularr Backend is running (Frontend not found)');
		}
	});
});

// -- Start the server ---------------------------------------------------------

app.listen(port, () => {
	console.log(`Server is running at http://localhost:${port}`);
});
