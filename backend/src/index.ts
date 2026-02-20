import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';

import { container } from './services/container/ServiceContainer';
import { AmuleService } from './services/AmuleService';
import { TelegramService } from './services/TelegramService';
import { TelegramIndexerService } from './services/TelegramIndexerService';
import { GluetunService } from './services/GluetunService';
import { AmuledService } from './services/AmuledService';
import { SystemService } from './services/SystemService';
import { MularrMonitoringService } from './services/MularrMonitoringService';
import { ExtensionsService } from './services/ExtensionsService';
import { amuleRoutes } from './routes/amuleRoutes';
import { systemRoutes } from './routes/systemRoutes';
import { qbittorrentRoutes } from './routes/qbittorrentRoutes';
import { indexerRoutes } from './routes/indexerRoutes';
import { extensionsRoutes } from './routes/extensionsRoutes';
import { telegramRoutes } from './routes/telegramRoutes';

const app = express();
const port = process.env.PORT || 8940;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -- Initialize & register services in container ------------------------------

// Initialize Amule Service
const amuleService = new AmuleService();
container.register(AmuleService, amuleService);

const amuledService = new AmuledService();
container.register(AmuledService, amuledService);

// Initialize Gluetun Service
const gluetunService = new GluetunService();
container.register(GluetunService, gluetunService);

// Initialize System Service
const systemService = new SystemService();
container.register(SystemService, systemService);

// Initialize Extensions Service
const extensionsService = new ExtensionsService();
container.register(ExtensionsService, extensionsService);

// Initialize Telegram Service (Optional)
if (process.env.TELEGRAM_BOT_TOKEN) {
	const topicId = process.env.TELEGRAM_TOPIC_ID ? parseInt(process.env.TELEGRAM_TOPIC_ID) : undefined;
	const tgService = new TelegramService(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID!, topicId);
	container.register(TelegramService, tgService);
}

// Initialize Telegram Indexer Service (Always init, but disconnected if no auth)
const indexerService = new TelegramIndexerService();
container.register(TelegramIndexerService, indexerService);
indexerService.start().catch((err) => console.error('Error starting initial Telegram indexer check:', err));

// Initialize and start Mularr Monitoring Service
const monitoringService = new MularrMonitoringService();
container.register(MularrMonitoringService, monitoringService);
monitoringService.start();

// -- Setup routes -------------------------------------------------------------

app.use('/api/system', systemRoutes());
app.use('/api/amule', amuleRoutes());
app.use('/api/extensions', extensionsRoutes());
app.use('/api/telegram', telegramRoutes());
app.use('/api/as-qbittorrent/api/v2', qbittorrentRoutes()); // qBittorrent compatibility for Sonarr/Radarr
app.use('/api/as-torznab-indexer', indexerRoutes()); // Torznab indexer for Sonarr/Radarr

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

// -- Log any uncaught requests to help debug ----------------------------------

app.use((req, res, next) => {
	console.log(`Unhandled request: ${req.method} ${req.originalUrl}`);
	next();
});

// -- Start the server ---------------------------------------------------------

app.listen(port, () => {
	console.log(`Server is running at http://localhost:${port}`);
});
