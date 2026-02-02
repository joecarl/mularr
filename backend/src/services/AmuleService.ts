import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { AmuleClient, SearchType } from 'amule-ec-client';

const execPromise = util.promisify(exec);

export class AmuleService {
	private readonly host = process.env.AMULE_HOST || 'localhost';
	private readonly port = process.env.AMULE_PORT || '4712';
	private readonly password = process.env.AMULE_PASSWORD || 'secret';
	private readonly client = new AmuleClient({ host: this.host, port: parseInt(this.port), password: this.password });

	private async runCommand(cmd: string): Promise<string> {
		// Set COLUMNS and TERM even if amulecmd 2.3.3 might not respect them for all commands,
		// some future versions or other utils might.
		const fullCmd = `amulecmd --host=${this.host} --port=${this.port} --password=${this.password} -c "${cmd}"`;
		try {
			const { stdout, stderr } = await execPromise(fullCmd, {
				env: { ...process.env, COLUMNS: '1000', TERM: 'xterm' },
			});
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
		try {
			const stats = await this.client.getStats();
			return {
				raw: `Download: ${stats.downloadSpeed} bytes/s\nUpload: ${stats.uploadSpeed} bytes/s`,
				downloadSpeed: stats.downloadSpeed,
				uploadSpeed: stats.uploadSpeed,
			};
		} catch (error) {
			console.error('EC Client Stats Error:', error);
			// Fallback to amulecmd if EC fails
			const output = await this.runCommand('statistics');
			return { raw: output };
		}
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
		try {
			const queue = await this.client.getDownloadQueue();
			const transfers = queue.map((file) => {
				// FileStatus enum mapping
				// 0=Ready, 1=Empty, 2=WaitingHash, 3=Hashing, 4=Error, 5=Insufficient, 6=Unknown, 7=Paused, 8=Completing, 9=Complete, 10=Allocating
				const statusMap: Record<number, string> = {
					0: 'Downloading',
					1: 'Empty',
					2: 'Waiting for Hash',
					3: 'Hashing',
					4: 'Error',
					5: 'Insufficient Space',
					6: 'Unknown',
					7: 'Paused',
					8: 'Completing',
					9: 'Completed',
					10: 'Allocating',
				};
				const status = statusMap[file.fileStatus] || `Status: ${file.fileStatus}`;
				const sizeFull = file.sizeFull || 0;
				const sizeDone = file.sizeDone || 0;
				const mbSize = (sizeFull / (1024 * 1024)).toFixed(2);
				const progress = sizeFull > 0 ? sizeDone / sizeFull : 0;

				return {
					rawLine: `> ${file.fileName} [${mbSize} MB] ${status} ${(progress * 100).toFixed(1)}%`,
					name: file.fileName,
					size: sizeFull,
					progress: progress,
					status: status,
					hash: file.fileHashHexString,
					completed: sizeDone,
					speed: file.speed || 0,
					sources: file.sourceCount,
					priority: file.downPrio,
					remaining: sizeFull - sizeDone,
				};
			});

			return {
				raw: `Downloads (${queue.length})`,
				list: transfers,
			};
		} catch (error) {
			console.error('EC Client Transfers Error:', error);
			const output = await this.runCommand('show dl');
			const clean = this.cleanOutput(output);
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
	}

	private lastSearchResults: any[] = [];
	private isSearching = false;

	async startSearch(query: string, type: string = 'Global') {
		console.log(`[AmuleService] Starting Search for: ${query}`);
		this.isSearching = true;
		this.lastSearchResults = [];

		try {
			// Convert string type to enum if possible, default to Global
			// Options: Local, Global, Kad, Web
			let searchType = SearchType.GLOBAL;
			const t = type.toLowerCase();
			if (t === 'local') searchType = SearchType.LOCAL;
			else if (t === 'kad') searchType = SearchType.KAD;

			await this.client.searchAsync(query, searchType);
			return 'Search Started';
		} catch (e) {
			console.error('Start Search Error:', e);
			this.isSearching = false;
			throw e;
		}
	}

	async getSearchResults() {
		try {
			const results = await this.client.searchResults();

			if (results && results.files) {
				const list = results.files.map((file) => ({
					name: file.fileName,
					size: (file.sizeFull / (1024 * 1024)).toFixed(2), // MB string for frontend
					sources: file.sourceCount,
					completeSources: file.sourceCount, // EC might distinguish, but use count for now
					type: '', // File type extension often in name
					link: file.hash.toString('hex'), // Link is now the hash for downloading
					hash: file.hash.toString('hex'),
				}));

				return {
					raw: `Found ${list.length} results`,
					list: list,
				};
			}
			return { raw: 'No results yet', list: [] };
		} catch (e: any) {
			console.error('Get Search Results Error:', e);
			return { raw: 'Error fetching results', list: [] };
		}
	}
	async getSearchResultsAmulecmd() {
		/* REMOVED LEGACY AMULECMD FALLBACK Code block ... */

		const output = await this.runCommand('results');
		const clean = this.cleanOutput(output);

		const results: any[] = [];
		const lines = clean.split('\n');

		lines.forEach((line) => {
			const trimmed = line.trim();

			// 1. Try to match the table format: "0.  Filename  Size  Sources"
			// Example: 0.    FileName [Type]    700.296     7    2
			// The format is often Index. Name [Type] Size Sources CompleteSources
			const tableMatch = trimmed.match(/^(\d+)\.\s+(.+?)\s{2,}(\d+(?:\.\d+)?)\s+(\d+)(?:\s+(\d+))?$/);
			if (tableMatch) {
				let name = tableMatch[2].trim();
				let type = '';

				// Check if name ends with [Type]
				const typeMatch = name.match(/(.+)\s+\[(.+?)\]$/);
				if (typeMatch) {
					name = typeMatch[1].trim();
					type = typeMatch[2].trim();
				}

				results.push({
					name: name,
					size: tableMatch[3], // Keep it as number string for now, backend usually returns MB in this column
					sources: tableMatch[4],
					completeSources: tableMatch[5] || '0',
					type: type,
					link: tableMatch[1],
				});
				return;
			}

			// 2. Fallback to format with ed2k link if present
			if (trimmed.startsWith('>')) {
				const content = trimmed.replace(/^>\s*\d+\.\s*/, '');
				// Match ed2k link and extract filename and size bytes
				const ed2kMatch = content.match(/ed2k:\/\/\|file\|([^|]+)\|(\d+)\|([A-F0-9]{32})\|/i);

				if (ed2kMatch) {
					const link = ed2kMatch[0];
					const fullName = ed2kMatch[1];
					const sizeInBytes = ed2kMatch[2];
					const sizeMB = (parseInt(sizeInBytes) / (1024 * 1024)).toFixed(3);

					results.push({
						name: fullName,
						size: sizeMB,
						sources: '?',
						completeSources: '?',
						type: '',
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
		console.log('Adding download:', link);

		// If it looks like a hash (32 hex chars), use EC client
		if (/^[a-fA-F0-9]{32}$/.test(link)) {
			try {
				await this.client.downloadSearchResult(Buffer.from(link, 'hex'));
				return `Added download for hash ${link}`;
			} catch (e) {
				console.error('EC Add Download Error:', e);
				throw e;
			}
		}

		// Try to use EC client for ED2K links if supported
		if (link.startsWith('ed2k://')) {
			try {
				await this.client.downloadEd2kLink(link);
				return `Added download for ed2k link`;
			} catch (e) {
				console.warn('EC Client failed to add ed2k link, falling back to amulecmd:', e);
			}
		}

		// Fallback to amulecmd for ED2K links or command line indices if any
		const cmd = /^\d+$/.test(link) ? `download ${link}` : `add ${link}`;
		const output = await this.runCommand(cmd);
		console.log('Add Download Output:', output);
		return output;
	}
}
