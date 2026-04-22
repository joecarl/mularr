import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import path from 'path';

import { __APP_MANIFEST__ } from './app-env';
import { container } from './services/container/ServiceContainer';
import { MainDB } from './services/db/MainDB';
import { AmuleService } from './services/AmuleService';
import { TelegramBotService } from './services/TelegramBotService';
import { TelegramIndexerService } from './services/TelegramIndexerService';
import { GluetunService } from './services/GluetunService';
import { AmuledService } from './services/AmuledService';
import { SystemService } from './services/SystemService';
import { MularrMonitoringService } from './services/MularrMonitoringService';
import { MediaProviderService } from './services/mediaprovider';
import { ExtensionsService } from './services/ExtensionsService';
import { SpeedHistoryService } from './services/SpeedHistoryService';
import { WsBroadcastService } from './services/WsBroadcastService';
import { amuleRoutes } from './routes/amuleRoutes';
import { systemRoutes } from './routes/systemRoutes';
import { qbittorrentRoutes } from './routes/qbittorrentRoutes';
import { indexerRoutes } from './routes/indexerRoutes';
import { extensionsRoutes } from './routes/extensionsRoutes';
import { telegramRoutes } from './routes/telegramRoutes';
import { mediaProviderRoutes } from './routes/mediaProviderRoutes';
import { statsRoutes } from './routes/statsRoutes';
import { authRoutes } from './routes/authRoutes';
import { blacklistRoutes } from './routes/blacklistRoutes';
import { authMiddleware } from './middleware/authMiddleware';
import { AuthService } from './services/AuthService';

console.log(`Starting Mularr v${__APP_MANIFEST__.version}...`);

const app = express();
const port = process.env.PORT || 8940;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -- Initialize & register services in container ------------------------------

// Initialize Auth Service (must be first so middleware can use it)
const authService = new AuthService();
container.register(AuthService, authService);
if (authService.isAuthEnabled()) {
	console.log('[Auth] Authentication is enabled.');
} else {
	console.log('[Auth] No credentials configured — running in open-access mode.');
}

async function main() {
	// Initialize Main DB
	const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../dev-data/database.sqlite');
	const mainDb = new MainDB(dbPath);
	container.register(MainDB, mainDb);

	// Initialize Amule Service
	const amuleService = new AmuleService();
	container.register(AmuleService, amuleService);

	const amuledService = new AmuledService();
	container.register(AmuledService, amuledService);
	await amuledService.startDaemon();

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
		const tgService = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID!, topicId);
		container.register(TelegramBotService, tgService);
	}

	// Initialize Telegram Indexer Service (Always init, but disconnected if no auth)
	const indexerService = new TelegramIndexerService();
	container.register(TelegramIndexerService, indexerService);
	indexerService.start().catch((err) => console.error('Error starting initial Telegram indexer check:', err));

	// Initialize and start Mularr Monitoring Service
	const monitoringService = new MularrMonitoringService();
	container.register(MularrMonitoringService, monitoringService);
	monitoringService.start();

	// Initialize MediaProvider Service (aggregates amule + telegram + future providers)
	const mediaProviderService = new MediaProviderService();
	container.register(MediaProviderService, mediaProviderService);

	// Initialize Speed History Service (records download/upload samples for the dashboard)
	const speedHistoryService = new SpeedHistoryService();
	container.register(SpeedHistoryService, speedHistoryService);
	speedHistoryService.start();

	// Initialize WebSocket broadcast service
	const wsBroadcastService = new WsBroadcastService();
	container.register(WsBroadcastService, wsBroadcastService);

	// -- Setup routes -------------------------------------------------------------

	// Wraps a router with authMiddleware so all its routes are protected
	const withAuth = (router: express.Router): express.Router => {
		const wrapper = express.Router();
		wrapper.use(authMiddleware);
		wrapper.use(router);
		return wrapper;
	};

	app.use('/api/auth', authRoutes());
	app.use('/api/system', withAuth(systemRoutes()));
	app.use('/api/amule', withAuth(amuleRoutes()));
	app.use('/api/media', withAuth(mediaProviderRoutes()));
	app.use('/api/stats', withAuth(statsRoutes()));
	app.use('/api/extensions', withAuth(extensionsRoutes()));
	app.use('/api/telegram', withAuth(telegramRoutes()));
	app.use('/api/as-qbittorrent/api/v2', qbittorrentRoutes()); // manages its own auth internally
	app.use('/api/as-torznab-indexer', withAuth(indexerRoutes())); // Torznab indexer for Sonarr/Radarr
	app.use('/api/blacklist', withAuth(blacklistRoutes()));

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

	// -- Start the server (HTTP + WebSocket on the same port) --------------------

	const httpServer = http.createServer(app);
	wsBroadcastService.setup(httpServer);
	wsBroadcastService.start();

	httpServer.listen(port, () => {
		console.log(`Server is running at http://localhost:${port}`);
	});
}

main().catch((err) => {
	console.error('Fatal error during startup:', err);
	process.exit(1);
});
