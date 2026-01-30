import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

export class TelegramService {
	private bot: TelegramBot | null = null;
	private chatId: string | null = null;
	private topicId: number | null = null;

	private escape(text?: string) {
		return text ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
	}

	constructor(token: string | undefined, chatId: string | undefined, topicId?: number) {
		if (token && chatId) {
			this.bot = new TelegramBot(token, { polling: false });
			this.chatId = chatId;
			this.topicId = topicId ?? null;
			console.log('Telegram Service initialized');
		} else {
			console.warn('Telegram Service NOT initialized: Missing token or chatId');
		}
	}

	async sendMessage(message: string) {
		if (!this.bot || !this.chatId) return;

		try {
			await this.bot.sendMessage(this.chatId, message, {
				parse_mode: 'HTML',
				message_thread_id: this.topicId ?? undefined,
			});
		} catch (error) {
			console.error('Error sending Telegram message:', error);
		}
	}

	private getSessionMessage(session: any) {
		const { userName, platform, nowPlaying, seriesName, seasonNumber, episodeNumber, deviceName } = session;

		const type = seriesName || episodeNumber ? '📺 TV-Show' : '🍿 Movie';

		const seriesInfo =
			(seriesName ? `<b>Serie:</b> ${this.escape(seriesName)} ` : '') +
			[
				seasonNumber !== null && seasonNumber !== undefined ? `<b>S</b>${this.escape(String(seasonNumber))}` : '',
				episodeNumber !== null && episodeNumber !== undefined ? `<b>E</b>${this.escape(String(episodeNumber))}` : '',
			]
				.filter(Boolean)
				.join(' - ');

		const message =
			`<b>Usuario:</b> 👤 ${this.escape(userName)}\n` +
			`<b>Plataforma:</b> ${this.escape(platform.charAt(0).toUpperCase() + platform.slice(1))}\n` +
			`<b>Tipo:</b> ${this.escape(type)}\n` +
			`<b>Título:</b> ${this.escape(nowPlaying)}\n` +
			seriesInfo +
			'\n' +
			(deviceName ? `<b>Dispositivo:</b> ${this.escape(deviceName)}\n` : '');

		return message;
	}

	async notifyStop(session: any) {
		if (!this.bot || !this.chatId) return;

		const message = `<b>🛑 Reproducción detenida</b>\n\n` + this.getSessionMessage(session);

		await this.sendMessage(message);
	}

	async notifyStart(session: any) {
		if (!this.bot || !this.chatId) return;

		const { posterUrl } = session;
		const message = `<b>▶️ Reproducción iniciada</b>\n\n` + this.getSessionMessage(session);

		// If there's a poster image, try to fetch it and send as photo (verify content-type), fallback to text
		if (posterUrl) {
			try {
				const resp = await axios.get(posterUrl, { responseType: 'arraybuffer' });
				const contentType = (resp.headers['content-type'] || resp.headers['Content-Type'] || '').toLowerCase();
				if (contentType.startsWith('image')) {
					const buffer = Buffer.from(resp.data, 'binary');
					await this.bot.sendPhoto(this.chatId, buffer, {
						caption: message,
						parse_mode: 'HTML',
						message_thread_id: this.topicId ?? undefined,
					});
				} else {
					throw new Error(`Poster URL returned non-image content-type: ${contentType}`);
				}
			} catch (error) {
				console.error('Error sending Telegram photo (fetch fallback)');
				// fallback to text
				await this.sendMessage(message);
			}
		} else {
			await this.sendMessage(message);
		}
	}
}
