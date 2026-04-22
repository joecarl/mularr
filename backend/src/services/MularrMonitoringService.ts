import { container } from './container/ServiceContainer';
import { AmuledService } from './AmuledService';
import { GluetunService } from './GluetunService';
import { TelegramBotService } from './TelegramBotService';

export class MularrMonitoringService {
	private readonly checkInterval: number = 10 * 1000; // 10 seconds
	private readonly periodicRestartIntervalHours: number = parseInt(process.env.AMULE_RESTART_INTERVAL_HOURS || '12');
	private intervalId: NodeJS.Timeout | null = null;
	private periodicRestartId: NodeJS.Timeout | null = null;
	private gluetunFailures: number = 0;
	private readonly maxGluetunFailures: number = 3;

	private readonly amuledService = container.get(AmuledService);
	private readonly gluetunService = container.get(GluetunService);

	private get telegramService(): TelegramBotService | null {
		try {
			return container.get(TelegramBotService);
		} catch {
			return null;
		}
	}

	public start() {
		console.log('Starting Mularr Monitoring Service...');
		this.notify('🚀 Mularr Monitoring Service started');
		this.check();
		this.intervalId = setInterval(() => this.check(), this.checkInterval);
		const periodicRestartInterval = this.periodicRestartIntervalHours * 60 * 60 * 1000;
		if (periodicRestartInterval > 0) {
			this.periodicRestartId = setInterval(() => this.periodicRestart(), periodicRestartInterval);
		}
	}

	public stop() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		if (this.periodicRestartId) {
			clearInterval(this.periodicRestartId);
			this.periodicRestartId = null;
		}
	}

	private async periodicRestart() {
		if (this.amuledService.isRestarting) return;
		const hours = this.periodicRestartIntervalHours;
		console.log(`Performing scheduled ${hours}h aMule daemon restart...`);
		await this.notify(`🔁 Scheduled restart of aMule daemon (every ${hours}h).`);
		await this.amuledService.restartDaemon();
	}

	private async notify(message: string) {
		const tg = this.telegramService;
		if (tg) {
			await tg.sendMessage(`<b>[Mularr Monitor]</b>\n${message}`);
		}
	}

	private async check() {
		if (this.amuledService.isRestarting) return;
		try {
			let shouldRestart = false;
			let restartReason = '';

			// 1. Check Gluetun if enabled
			if (this.gluetunService.isEnabled) {
				const status = await this.gluetunService.getVpnStatus();
				if (status && status.status === 'running') {
					this.gluetunFailures = 0; // Reset counter
					const port = await this.gluetunService.getPortForwarded();
					if (port) {
						const changed = await this.amuledService.updateCoreConfig(port);
						if (changed) {
							shouldRestart = true;
							restartReason = `🔄 Gluetun port changed to ${port}`;
						}
					}
				} else {
					this.gluetunFailures++;
					const statusStr = status ? status.status : 'unreachable';
					console.warn(`⚠️ Gluetun health check failed (${this.gluetunFailures}/${this.maxGluetunFailures}). Status: ${statusStr}`);

					if (this.gluetunFailures >= this.maxGluetunFailures) {
						console.error(`🚨 Gluetun health check failed ${this.maxGluetunFailures} consecutive times. Suicide triggered.`);
						await this.notify(
							`🚨 Gluetun health check failed ${this.maxGluetunFailures} consecutive times (Status: ${statusStr}). Restarting container...`
						);
						// Give a small delay for the notification to be sent
						setTimeout(() => process.exit(1), 2000);
						return; // Stop further checks
					}
				}
			}

			// 2. Check aMule daemon status
			const isRunning = await this.amuledService.isDaemonRunning();
			if (!isRunning) {
				shouldRestart = true;
				restartReason = restartReason ? `${restartReason} and ⚠️ aMule daemon was not running` : '⚠️ aMule daemon was not running';
			}

			if (shouldRestart) {
				console.log(`${restartReason}. Restarting/Starting aMule daemon...`);
				await this.notify(`${restartReason}. Restarting aMule...`);
				await this.amuledService.restartDaemon();
			}
		} catch (error: any) {
			console.error('Mularr Monitoring Service Error:', error.message);
		}
	}
}
