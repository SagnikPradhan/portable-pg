import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { test as base, expect, vi } from 'vitest';
import { startServer } from '#src/server';

const binaries =
	process.env['PPG_BINARIES'] ?? `vendor/postgres/${process.platform}-${process.arch}`;

const test = base.extend<{ directory: string }>({
	directory: async ({ onTestFinished }, use) => {
		const root = await mkdtemp(join(tmpdir(), 'ppg-test-'));
		onTestFinished(() => rm(root, { recursive: true, force: true }));
		await use(join(root, 'data'));
	},
});

test('starts Postgres and answers over its socket', async ({ directory }) => {
	const server = await startServer({ directory, binaries });

	expect(await query(server.url, 'select current_user')).toBe('postgres');
	expect(await query(server.url, 'show listen_addresses')).toBe('');
	await server.stop();
});

test('creates the user and applies the settings it is given', async ({ directory }) => {
	const settings = { max_wal_size: '256MB', application_name: "it's quoted" };
	const server = await startServer({ directory, binaries, user: 'rupee', settings });

	expect(await query(server.url, 'select current_user')).toBe('rupee');
	expect(await query(server.url, 'show max_wal_size')).toBe('256MB');
	await server.stop();
});

test('ignores settings that would open a TCP port', async ({ directory }) => {
	const server = await startServer({ directory, binaries, settings: { listen_addresses: '*' } });

	expect(await query(server.url, 'show listen_addresses')).toBe('');
	await server.stop();
});

test('stops Postgres and keeps the data for the next start', async ({ directory }) => {
	const first = await startServer({ directory, binaries });
	await query(first.url, 'create table kept as select 1 as one');
	await first.stop();
	expect(existsSync(join(directory, 'postmaster.pid'))).toBe(false);

	const second = await startServer({ directory, binaries });
	expect(await query(second.url, 'select one from kept')).toBe(1);
	await second.stop();
});

test('keeps the data in a temporary directory that stop deletes when given none', async () => {
	const server = await startServer({ binaries });
	const directory = join(new URL(server.url).searchParams.get('host') ?? '', 'data');
	expect(existsSync(join(directory, 'PG_VERSION'))).toBe(true);

	await server.stop();
	expect(existsSync(directory)).toBe(false);
});

test('starts after a killed server left its pid file behind', async ({ directory }) => {
	await startServer({ directory, binaries });
	const pid = await postmaster(directory);
	process.kill(pid, 'SIGKILL');
	await until(() => !alive(pid));

	const server = await startServer({ directory, binaries });
	expect(await query(server.url, 'select 1')).toBe(1);
	await server.stop();
});

test('puts a custom port in the connection URL', async ({ directory }) => {
	const server = await startServer({ directory, binaries, settings: { port: '5433' } });

	expect(await query(server.url, 'show port')).toBe('5433');
	await server.stop();
});

test('resolves every call to stop, even after stopping', async ({ directory }) => {
	const server = await startServer({ directory, binaries });

	await Promise.all([server.stop(), server.stop()]);
	await server.stop();
});

test('refuses a data directory in use and keeps its server running', async ({ directory }) => {
	const first = await startServer({ directory, binaries });

	await expect(startServer({ directory, binaries })).rejects.toThrow('did not start');
	expect(await query(first.url, 'select 1')).toBe(1);
	await first.stop();
});

test('leaves a newer server running when stopping one whose Postgres was killed', async ({
	directory,
}) => {
	const first = await startServer({ directory, binaries });
	const pid = await postmaster(directory);
	process.kill(pid, 'SIGKILL');
	await until(() => !alive(pid));

	const second = await startServer({ directory, binaries });
	await first.stop();
	expect(await query(second.url, 'select 1')).toBe(1);
	await second.stop();
});

test('rejects stop when Postgres fails to shut down, and stops on retry', async ({
	directory,
	onTestFinished,
}) => {
	const server = await startServer({ directory, binaries });
	const socket = new URL(server.url).searchParams.get('host') ?? '';
	const pid = await postmaster(directory);
	vi.stubEnv('PGCTLTIMEOUT', '2');
	process.kill(pid, 'SIGSTOP');
	onTestFinished(() => void (alive(pid) && process.kill(pid, 'SIGCONT')));

	await expect(server.stop()).rejects.toThrow('did not stop');
	expect(existsSync(socket)).toBe(true);

	process.kill(pid, 'SIGCONT');
	await server.stop();
	expect(alive(pid)).toBe(false);
	expect(existsSync(socket)).toBe(false);
});

test('fails to start as a user the existing data directory does not have', async ({
	directory,
}) => {
	await (await startServer({ directory, binaries })).stop();

	await expect(startServer({ directory, binaries, user: 'rupee' })).rejects.toThrow(
		'role "rupee" does not exist',
	);
	expect(existsSync(join(directory, 'postmaster.pid'))).toBe(false);
});

test('stops Postgres and removes its socket when the Node process that started it is killed', async ({
	directory,
}) => {
	const server = import.meta.resolve('#src/server');
	const script = `await (await import('${server}')).startServer(${JSON.stringify({ directory, binaries })}).then((s) => console.log(s.url)); setInterval(() => {}, 1000);`;
	const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
		stdio: ['ignore', 'pipe', 'inherit'],
	});

	const url = await new Promise<string>((resolve, reject) => {
		child.stdout.once('data', (data) => resolve(String(data).trim()));
		child.once('exit', (code) => reject(new Error(`the parent exited with ${code}`)));
	});
	const pid = await postmaster(directory);
	child.kill('SIGKILL');

	const socket = new URL(url).searchParams.get('host') ?? '';
	await until(() => !alive(pid) && !existsSync(socket));
	expect(alive(pid)).toBe(false);
	expect(existsSync(socket)).toBe(false);
});

const query = async (url: string, sql: string) => {
	const client = new pg.Client(url);
	await client.connect();
	const result = await client.query({ text: sql, rowMode: 'array' });
	await client.end();
	return result.rows[0]?.[0];
};

const postmaster = async (directory: string) =>
	Number((await readFile(join(directory, 'postmaster.pid'), 'utf8')).split('\n')[0]);

const until = async (done: () => boolean) => {
	const deadline = Date.now() + 10_000;
	while (!done() && Date.now() < deadline) await setTimeout(100);
};

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
