import http from 'http';
import express from 'express';
import cors from 'cors';
import path from 'path';

import { __APP_CONFIG__, __APP_MANIFEST__ } from './app-env';
import { container } from './services/container/ServiceContainer';
import { AppEvents } from './services/AppEvents';
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
import { LoggerFactory } from './services/logging/Logger';
import {
	createMockDatabase,
	MockAmuledService,
	MockAmuleService,
	MockGluetunService,
	MockSpeedHistoryService,
	MockSystemService,
	MockTelegramIndexerService,
} from './mock';

const logger = LoggerFactory.create('Main');

// A rejected promise nobody awaited (fire-and-forget calls, listeners) must not take the whole
// container down with it, which is Node's default. Log it and keep serving.
process.on('unhandledRejection', (reason) => {
	logger.error('Unhandled promise rejection:', reason);
});

logger.info(`Starting Mularr v${__APP_MANIFEST__.version}...`);

const app = express();
const { port, databasePath: dbPath, mockMode } = __APP_CONFIG__;
if (mockMode) {
	logger.warn(`MOCK_MODE is enabled: serving generated data, nothing connects to aMule, Gluetun or Telegram. Data directory: ${path.dirname(dbPath)}`);
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -- Initialize & register services in container ------------------------------
// In mock mode the services that reach outside the process (aMule and its daemon, Gluetun, the public IP
// lookups, Telegram) are swapped for the stand-ins in src/mock; everything else runs the real code on top.

// Event bus goes first so any service can emit or subscribe from its constructor
container.register(AppEvents, new AppEvents());

// Initialize Auth Service (must be first so middleware can use it)
const authService = new AuthService(path.dirname(dbPath));
container.register(AuthService, authService);
if (authService.isAuthEnabled()) {
	logger.info('Authentication is enabled.');
} else {
	logger.info('No credentials configured — running in open-access mode.');
}

async function main() {
	// Initialize Main DB (the mock one is wiped and reseeded on every start)
	const mainDb = mockMode ? createMockDatabase(dbPath) : new MainDB(dbPath);
	container.register(MainDB, mainDb);

	// Initialize Amule Service
	const amuleService = mockMode ? new MockAmuleService() : new AmuleService();
	container.register(AmuleService, amuleService);

	const amuledService = mockMode ? new MockAmuledService() : new AmuledService();
	container.register(AmuledService, amuledService);
	amuledService.applySharedDirsFromEnvIfNeeded();
	await amuledService.startDaemon();

	// Initialize Gluetun Service
	const gluetunService = mockMode ? new MockGluetunService() : new GluetunService();
	container.register(GluetunService, gluetunService);

	// Initialize System Service
	const systemService = mockMode ? new MockSystemService() : new SystemService();
	container.register(SystemService, systemService);

	// Initialize Extensions Service
	const extensionsService = new ExtensionsService();
	container.register(ExtensionsService, extensionsService);

	// Initialize Telegram Service (Optional)
	if (__APP_CONFIG__.telegramBot) {
		const { token, chatId, topicId } = __APP_CONFIG__.telegramBot;
		container.register(TelegramBotService, new TelegramBotService(token, chatId, topicId));
	}

	// Initialize Telegram Indexer Service (Always init, but disconnected if no auth)
	const indexerService = mockMode ? new MockTelegramIndexerService() : new TelegramIndexerService();
	container.register(TelegramIndexerService, indexerService);
	indexerService.start().catch((err) => logger.error('Error starting initial Telegram indexer check:', err));

	// Initialize and start Mularr Monitoring Service
	const monitoringService = new MularrMonitoringService();
	container.register(MularrMonitoringService, monitoringService);
	monitoringService.start();

	// Initialize MediaProvider Service (aggregates amule + telegram + future providers)
	const mediaProviderService = new MediaProviderService();
	container.register(MediaProviderService, mediaProviderService);

	// Initialize Speed History Service (records download/upload samples for the dashboard)
	const speedHistoryService = mockMode ? new MockSpeedHistoryService() : new SpeedHistoryService();
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
	app.use('/api/as-torznab-indexer', withAuth(indexerRoutes())); // Torznab indexer for Sonarr/Radarr/Lidarr
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
		logger.debug(`Unhandled request: ${req.method} ${req.originalUrl}`);
		next();
	});

	// -- Start the server (HTTP + WebSocket on the same port) --------------------

	const httpServer = http.createServer(app);
	wsBroadcastService.setup(httpServer);
	wsBroadcastService.start();

	httpServer.listen(port, () => {
		logger.info(`Server is running at http://localhost:${port}`);
	});
}

main().catch((err) => {
	logger.error('Fatal error during startup:', err);
	process.exit(1);
});
