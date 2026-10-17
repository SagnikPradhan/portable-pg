import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const BINARIES = realpathSync(
	process.env['PPG_BINARIES'] ?? `vendor/postgres/${process.platform}-${process.arch}`,
);

const LIFETIME = '300';

const exec = promisify(execFile);

/** Where a test runs the binaries: a scratch directory here, or a container. */
export type Machine = {
	run: (command: string, ...args: string[]) => Promise<string>;
	binaries: string;
	work: string;
	remove: () => Promise<void>;
};

/** This machine, with the binaries copied away from where they were built. */
export const host = async (): Promise<Machine> => {
	const work = await mkdtemp(join(tmpdir(), 'ppg-'));
	const binaries = join(work, 'moved');
	await shell('cp', '-a', BINARIES, binaries);

	const remove = async () => {
		await shell(`${binaries}/bin/pg_ctl`, 'stop', '-m', 'immediate', '-D', `${work}/data`).catch(
			() => '',
		);
		await rm(work, { recursive: true, force: true });
	};

	return { run: shell, binaries, work, remove };
};

/** A container of `image`, running as nobody because Postgres refuses to run as root. It removes itself
 * once `sleep` ends, in case a killed test run never calls `remove`.
 * See https://www.postgresql.org/docs/18/app-initdb.html */
export const container = async (image: string): Promise<Machine> => {
	const mount = `${BINARIES}:/opt/postgres:ro`;
	const user = ['--user', '65534:65534'];
	const id = await shell(
		'docker',
		'run',
		'-d',
		'--rm',
		...user,
		'-v',
		mount,
		image,
		'sleep',
		LIFETIME,
	);
	const run = (command: string, ...args: string[]) => shell('docker', 'exec', id, command, ...args);

	const remove = async () => void (await shell('docker', 'rm', '-f', id));

	return { run, binaries: '/opt/postgres', work: await run('mktemp', '-d'), remove };
};

/** A data directory in a machine's scratch space and the binaries that serve it. */
export type Cluster = {
	work: string;
	init: () => Promise<string>;
	start: () => Promise<string>;
	stop: () => Promise<string>;
	sql: (sql: string, database?: string) => Promise<string>;
	client: (name: string, ...args: string[]) => Promise<string>;
};

export const cluster = (machine: Machine, binaries = machine.binaries): Cluster => {
	const data = `${machine.work}/data`;
	const socket = `-c listen_addresses='' -c unix_socket_directories='${machine.work}'`;
	const tool = (name: string, ...args: string[]) => machine.run(`${binaries}/bin/${name}`, ...args);
	const client = (name: string, ...args: string[]) =>
		tool(name, '-h', machine.work, '-U', 'postgres', ...args);

	return {
		work: machine.work,
		init: () =>
			tool('initdb', '-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C'),
		start: () =>
			tool('pg_ctl', 'start', '-w', '-D', data, '-l', `${machine.work}/server.log`, '-o', socket),
		stop: () => tool('pg_ctl', 'stop', '-w', '-D', data),
		sql: (sql: string, database = 'postgres') =>
			client('psql', '-qAtX', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql),
		client,
	};
};

export const shell = async (command: string, ...args: string[]) =>
	(await exec(command, args)).stdout.trim();
