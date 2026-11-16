import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test as base, expect } from 'vitest';
import { BINARIES } from './postgres.ts';

const IMAGE = 'node:24-bookworm-slim';
const NOBODY = 65534;

const exec = promisify(execFile);

const test = base.extend<{ inRoot: (script: string) => Promise<Record<string, unknown>> }>({
	inRoot: async ({ onTestFinished }, use) => {
		const work = await mkdtemp(join(tmpdir(), 'ppg-root-'));
		onTestFinished(() => rm(work, { recursive: true, force: true }));
		await chmod(work, 0o755);

		await use(async (script) => {
			const { stdout } = await exec('docker', [
				...['run', '--rm', '--user', '0:0'],
				...['-v', `${process.cwd()}:/pkg:ro`, '-v', `${BINARIES}:/opt/postgres:ro`],
				...['-v', `${work}:/work`, IMAGE],
				...['node', '--input-type=module', '-e', PRELUDE + script],
			]);
			return JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
		});
	},
});

// Every script ends by printing one JSON line and leaves /work empty, since root made it.
const PRELUDE = `
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startServer } from '/pkg/src/server.ts';
const binaries = '/opt/postgres';
const owner = (path) => statSync(path).uid;
const sql = (url, text) => execFileSync('/opt/postgres/bin/psql', ['-XAtq', '-d', url, '-c', text], { encoding: 'utf8' }).trim();
const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith('ppg-'));
const finish = (result) => { for (const name of readdirSync('/work')) rmSync('/work/' + name, { recursive: true, force: true }); console.log(JSON.stringify(result)); };
`;

test('starts as root and runs Postgres as nobody', async ({ inRoot }) => {
	const result = await inRoot(`
		const directory = '/work/data';
		const server = await startServer({ directory, binaries });
		const user = sql(server.url, 'select current_user');
		const dataOwner = owner(directory);
		await server.stop();
		finish({ user, dataOwner, pid: existsSync(directory + '/postmaster.pid') });
	`);

	expect(result).toEqual({ user: 'postgres', dataOwner: NOBODY, pid: false });
});

test('removes the socket and the temporary data directory on stop as root', async ({ inRoot }) => {
	const result = await inRoot(`
		const server = await startServer({ binaries });
		await server.stop();
		finish({ left: leftovers() });
	`);

	expect(result).toEqual({ left: [] });
});

test('runs Postgres as the user in runAs, which must exist on the system', async ({ inRoot }) => {
	const result = await inRoot(`
		const directory = '/work/data';
		const server = await startServer({ directory, binaries, runAs: { uid: 1000, gid: 1000 } });
		const stats = statSync(directory);
		await server.stop();
		finish({ uid: stats.uid, gid: stats.gid });
	`);

	expect(result).toEqual({ uid: 1000, gid: 1000 });
});

test('refuses a data directory root owns and says who should', async ({ inRoot }) => {
	const result = await inRoot(`
		const directory = '/work/data';
		await (await startServer({ directory, binaries })).stop();
		execFileSync('chown', ['-R', '0:0', directory]);
		const error = await startServer({ directory, binaries }).catch((e) => e);
		finish({ code: error.code, message: error.message });
	`);

	expect(result).toMatchObject({
		code: 'DATA_DIRECTORY_OWNER',
		message: expect.stringMatching(/\/work\/data is owned by 0.*65534.*chown/s),
	});
});
