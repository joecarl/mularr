import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
// import { sessionRoutes } from './routes/sessionRoutes';

// import { SessionManagerService } from './services/SessionManagerService';
import { TelegramService } from './services/TelegramService';

import { container } from './services/ServiceContainer';

const app = express();
const port = process.env.PORT || 8940;

app.use(cors());
app.use(express.json());


// -- Initialize & register services in container ------------------------------

const topicId = process.env.TELEGRAM_TOPIC_ID ? parseInt(process.env.TELEGRAM_TOPIC_ID) : undefined;
const tgService = new TelegramService(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, topicId);
container.register(TelegramService, tgService);

// const sessionManager = new SessionManagerService();
// container.register(SessionManagerService, sessionManager);


// -- Setup routes -------------------------------------------------------------

//app.use('/api/users', userRoutes());
// app.use('/api/sessions', sessionRoutes());


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
	console.log(`Server is running on port ${port}`);
});
