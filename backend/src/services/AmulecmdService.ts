import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execPromise = util.promisify(exec);

export class AmulecmdService {
	private readonly host: string;
	private readonly port: string;
	private readonly password: string;

	constructor() {
		this.host = process.env.AMULE_HOST || 'localhost';
		this.port = process.env.AMULE_PORT || '4712';
		this.password = process.env.AMULE_PASSWORD || 'secret';
	}

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

	private getMockData(cmd: string): string {
		if (cmd === 'show dl') return ' > 1. Linux.iso [100%]\n > 2. Ubuntu.iso [50%]';
		if (cmd === 'show servers') return ' > [192.168.1.1:4661] eMule Security No1\n > [10.0.0.1:4661] TV Underground';
		return `Mock output for ${cmd}`;
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

	async getStats() {
		const output = await this.runCommand('statistics');
		return { raw: output };
	}

	async getStatus() {
		const output = await this.runCommand('status');
		const clean = this.cleanOutput(output);

		return {
			raw: clean,
		};
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

	async getSearchResults() {
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

	async addDownload(link: string): Promise<string> {
		// Fallback to amulecmd for ED2K links or command line indices if any
		const cmd = /^\d+$/.test(link) ? `download ${link}` : `add ${link}`;
		const output = await this.runCommand(cmd);
		console.log('Add Download Output:', output);
		return output;
	}
}
