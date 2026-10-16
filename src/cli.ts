#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fetchBinaries } from './fetch.ts';

const HELP = `usage: ppg <command>

commands:
  fetch [dir]  download this version's Postgres binaries into dir, or the user's cache, and print where
  version      print this version of portable-pg
  help         print this help
`;

const PACKAGE = new URL('../package.json', import.meta.url);

const commands: Record<string, (args: string[]) => Promise<void>> = {
	fetch: async ([directory]) => console.log(await fetchBinaries({ directory })),
	version: async () => console.log(JSON.parse(await readFile(PACKAGE, 'utf8')).version),
	help: async () => void process.stdout.write(HELP),
};

const main = async () => {
	// See https://nodejs.org/docs/latest-v24.x/api/util.html#utilparseargsconfig
	const options = { help: { type: 'boolean', short: 'h' } } as const;
	const parsed = parseArgs({ options, allowPositionals: true });
	const [name = 'help', ...args] = parsed.values.help ? ['help'] : parsed.positionals;

	const command = commands[name];
	if (!command) throw new Error(`unknown command ${name}. Run ppg help for the commands.`);
	await command(args);
};

await main().catch((error: Error) => {
	process.stderr.write(`ppg: ${error.message}\n`);
	process.exit(1);
});
