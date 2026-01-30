import { exec } from 'child_process';
import util from 'util';

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
		} catch (error) {
			console.error('AmuleCmd Error:', error);
			// If amulecmd is missing (dev env), return mock data
			if ((error as any).code === 127 || (error as any).message.includes('not found')) {
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
		return { raw: output };
	}

	async addDownload(link: string) {
		const output = await this.runCommand(`add ${link}`);
		return output;
	}
}
