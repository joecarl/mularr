import { Router } from 'express';
import { TelegramController } from '../controllers/TelegramController';

export const telegramRoutes = () => {
	const router = Router();
	const controller = new TelegramController();

	router.get('/status', controller.getStatus);
	router.post('/auth/start', controller.startAuth);
	router.post('/auth/code', controller.submitCode);
	router.post('/auth/password', controller.submitPassword);
	router.post('/logout', controller.logout);
	router.put('/search-enabled', controller.setSearchEnabled);
	router.put('/feed-enabled', controller.setFeedEnabled);

	router.get('/chats', controller.getChats);
	router.put('/chats/:chatId/indexing', controller.updateChatIndexing);
	router.post('/chats/:chatId/index', controller.indexChatNow);
	router.delete('/chats/:chatId/index', controller.clearChatIndex);
	router.delete('/chats/:chatId', controller.deleteChat);

	// Channel links the account joins in the background; 'finished' goes before ':id' so it is not taken for one
	router.get('/join-queue', controller.getJoinQueue);
	router.post('/join-queue', controller.addJoinLinks);
	router.delete('/join-queue/finished', controller.clearFinishedJoins);
	router.post('/join-queue/:id/retry', controller.retryJoin);
	router.delete('/join-queue/:id', controller.removeJoin);

	return router;
};
