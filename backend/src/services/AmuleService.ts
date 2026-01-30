import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execPromise = util.promisify(exec);

export class AmuleService {
	private host = process.env.AMULE_HOST || 'localhost';
	private port = process.env.AMULE_PORT || '4712';
	private password = process.env.AMULE_PASSWORD || 'secret';

	private async runCommand(cmd: string): Promise<string> {
		// -w waits for command completion? amulecmd usually waits.
		const fullCmd = `amulecmd --host=${this.host} --port=${this.port} --password=${this.password} -c "${cmd}"`;
		try {
			const { stdout, stderr } = await execPromise(fullCmd);
			/* 
               amulecmd often prints the command prompt in the output, e.g. " > Command: statistics\n ...output... > "
               We might need to clean the output.
            */
			return stdout;
		} catch (error: any) {
			console.error('AmuleCmd Error:', error);
			// If amulecmd is missing (dev env), return mock data
			if (error.code === 127 || error.message.includes('not found')) {
				console.warn('amulecmd not found. Returning mock data.');
				return this.getMockData(cmd);
			}
			throw new Error('Failed to execute amule command');
		}
	}

	// Basic Mock data for development without aMule
	private getMockData(cmd: string): string {
		if (cmd === 'show dl') return ' > 1. Linux.iso [100%]\n > 2. Ubuntu.iso [50%]';
		if (cmd === 'show servers') return ' > [192.168.1.1:4661] eMule Security No1\n > [10.0.0.1:4661] TV Underground';
		return `Mock output for ${cmd}`;
	}

	async getStats() {
		const output = await this.runCommand('statistics');
		return { raw: output };
	}

	async getConfig() {
		const output = await this.runCommand('status');
		const clean = this.cleanOutput(output);

		const config: any = {};

		// Try to read local config file for more details, as amulecmd 2.3.3 is limited
		try {
			const home = process.env.HOME || '/home/node';
			const confPath = path.join(home, '.aMule', 'amule.conf');
			if (fs.existsSync(confPath)) {
				const content = fs.readFileSync(confPath, 'utf-8');
				const lines = content.split('\n');
				const findVal = (key: string) =>
					lines
						.find((l) => l.startsWith(key + '='))
						?.split('=')[1]
						?.trim();

				config.nick = findVal('Nick');
				config.tcpPort = findVal('Port');
				config.udpPort = findVal('UDPPort');
				config.maxSources = findVal('MaxSourcesPerFile');
				config.maxConnections = findVal('MaxConnections');
				config.downloadCap = findVal('DownloadCapacity');
				config.uploadCap = findVal('UploadCapacity');
				config.incomingDir = findVal('IncomingDir');
				config.tempDir = findVal('TempDir');
			}
		} catch (e) {
			console.warn('Could not read local amule.conf:', e);
		}

		// Fallback/Supplement with any info from status if needed (though status is mostly connection info)
		return {
			raw: clean,
			values: config,
		};
	}

	private cleanOutput(output: string): string {
		// Remove the initial connection message
		// "This is amulecmd ... Succeeded! Connection established ..."
		const lines = output.split('\n');
		const startIdx = lines.findIndex((line) => line.includes('Connection established'));
		if (startIdx !== -1) {
			return lines.slice(startIdx + 1).join('\n');
		}
		return output;
	}

	async getServers() {
		const output = await this.runCommand('show servers');
		const clean = this.cleanOutput(output);

		const servers: any[] = [];
		const regex = /> \[(.+):(\d+)\]\s+(.+)/;

		clean.split('\n').forEach((line) => {
			const match = line.trim().match(regex);
			if (match) {
				servers.push({
					ip: match[1],
					port: match[2],
					name: match[3].trim(),
				});
			}
		});

		return {
			raw: clean,
			list: servers,
		};
	}

	async getTransfers() {
		const output = await this.runCommand('show dl');
		const clean = this.cleanOutput(output);
		// Example: > 1464BC... File.avi [ 700 MB] Status: Downloading
		// Use a simple splitter for now as format can vary
		// We'll rely on the raw line for display until we have better parsing

		const transfers = clean
			.split('\n')
			.filter((l) => l.trim().startsWith('>'))
			.map((l) => {
				return { rawLine: l.trim().replace(/^>\s*/, '') };
			});

		return {
			raw: clean,
			list: transfers,
		};
	}

	async startSearch(query: string, type: string = 'Global') {
		// amulecmd: "search <type> <keyword>"
		// types: local, global, kad, http
		const output = await this.runCommand(`search ${type.toLowerCase()} ${query}`);
		return output;
	}

	async getSearchResults() {
		const output = await this.runCommand('results');
		const clean = this.cleanOutput(output);

		const results: any[] = [];
		const lines = clean.split('\n');

		lines.forEach((line) => {
			const trimmed = line.trim();

			// 1. Try to match the table format: "0.  Filename  Size  Sources"
			// Example: 0.    Pedro Y El Dragon Eliot (1977)...      700.296     7
			const tableMatch = trimmed.match(/^(\d+)\.\s+(.+?)\s{2,}(\d+(?:\.\d+)?)\s+(\d+)$/);
			if (tableMatch) {
				results.push({
					name: tableMatch[2].trim(),
					size: tableMatch[3] + ' MB',
					link: tableMatch[1], // Use index as "link" for the download command
				});
				return;
			}

			// 2. Fallback to format with ed2k link if present
			if (trimmed.startsWith('>')) {
				const content = trimmed.replace(/^>\s*\d+\.\s*/, '');
				const ed2kMatch = content.match(/ed2k:\/\/\|file\|[^|]+\|\d+\|[A-F0-9]{32}\|(?:\/|[^|]+\|(?:\/|.*\/))/i);

				if (ed2kMatch) {
					const link = ed2kMatch[0];
					const beforeLink = content.replace(link, '').trim();
					const nameMatch = beforeLink.match(/^(.+?)\s*\(/);
					const name = nameMatch ? nameMatch[1].trim() : beforeLink;
					const sizeMatch = beforeLink.match(/\(([^)]+)\)/);
					const size = sizeMatch ? sizeMatch[1].trim() : 'Unknown';

					results.push({
						name,
						size,
						link,
					});
				}
			}
		});

		return {
			raw: clean,
			list: results,
		};
	}

	async addDownload(link: string) {
		// If it's a number, use 'download' command (for search results), otherwise use 'add' (for ed2k links)
		const cmd = /^\d+$/.test(link) ? `download ${link}` : `add ${link}`;
		const output = await this.runCommand(cmd);
		return output;
	}
}
