import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fetchBinaries } from './fetch.ts';
import { shutdown } from './postmaster.ts';

// Runs from src/ as TypeScript in this repository's tests, and from dist/ as JavaScript once built.
const WATCHDOG = fileURLToPath(new URL(`./watchdog${extname(import.meta.url)}`, import.meta.url));

const run = promisify(execFile);

/** How to start Postgres. Every option has a default. */
export type StartOptions = {
	/** The data directory, created on first start. Defaults to a temporary one, deleted once the server stops. */
	directory?: string;
	/** The directory holding the binaries, downloaded into it when missing. Defaults to the user's cache. */
	binaries?: string;
	/** The superuser to create and connect as. Defaults to `postgres`. */
	user?: string;
	/** Server settings, as in postgresql.conf, such as `{ max_wal_size: '256MB' }`. */
	settings?: Record<string, string>;
};

/** A running Postgres, stopped by a watchdog process if this one dies first. */
export type Server = {
	/** A connection string for the Unix socket, which `pg` and libpq accept. */
	url: string;
	/**
	 * Stops Postgres and removes its socket, and the data directory if it was temporary. Rejects if
	 * Postgres does not stop; call it again to retry.
	 */
	stop: () => Promise<void>;
};

/** Starts Postgres over a private Unix socket. Fails if another server runs on the data directory. */
export const startServer = async (o: StartOptions = {}): Promise<Server> => {
	const bin = join(await fetchBinaries({ directory: o.binaries }), 'bin');
	const socket = await mkdtemp(join(tmpdir(), 'ppg-'));
	const cluster = { bin, socket, directory: o.directory ?? join(socket, 'data') };

	return launch(cluster, o.user ?? 'postgres', o.settings ?? {}).catch((error) =>
		shutdown(join(bin, 'pg_ctl'), cluster.directory, socket)
			.catch(() => undefined)
			.then(() => Promise.reject(error)),
	);
};

type Cluster = { bin: string; directory: string; socket: string };

const launch = async (c: Cluster, user: string, settings: Record<string, string>) => {
	const url = connection(c.socket, user, settings);

	await initialise(c, user);
	await start(c, settings);
	await connect(c, url);
	return watch(c, url);
};

const initialise = async (c: Cluster, user: string) => {
	if (existsSync(join(c.directory, 'PG_VERSION'))) return;

	await run(join(c.bin, 'initdb'), [
		'-D',
		c.directory,
		'-U',
		user,
		'--auth=trust',
		'-E',
		'UTF8',
		'--locale=C',
	]);
};

const start = async (c: Cluster, settings: Record<string, string>) => {
	const log = join(c.directory, 'server.log');
	const options = flags(c.socket, settings);

	await run(join(c.bin, 'pg_ctl'), [
		'start',
		'-w',
		'-D',
		c.directory,
		'-l',
		log,
		'-o',
		options,
	]).catch(async (error) => {
		const lines = (await readFile(log, 'utf8').catch(() => '')).trimEnd().split('\n');
		const tail = lines.slice(-5).join('\n');
		const context = tail ? `:\n${tail}` : '';
		throw new Error(`Postgres did not start on ${c.directory}${context}`, { cause: error });
	});
};

// initdb created the user only if the data directory was new, so an existing one may lack it.
const connect = async (c: Cluster, url: string) => {
	await run(join(c.bin, 'psql'), ['-XAtq', '-d', url, '-c', 'select']).catch((error) => {
		const context = error.stderr ? `: ${error.stderr.trimEnd()}` : '';
		throw new Error(`Cannot connect to ${c.directory}${context}`, { cause: error });
	});
};

const watch = async (c: Cluster, url: string): Promise<Server> => {
	const pgCtl = join(c.bin, 'pg_ctl');
	const watchdog = spawn(process.execPath, [WATCHDOG, pgCtl, c.directory, c.socket], {
		stdio: ['pipe', 'ignore', 'ignore'],
	});
	await once(watchdog, 'spawn');
	const exited = once(watchdog, 'exit');
	// Lets Node exit without waiting on the watchdog. See
	// https://nodejs.org/docs/latest-v24.x/api/child_process.html#subprocessunref
	watchdog.unref();
	// A pipe is a socket, though Node types it as any writable stream.
	(watchdog.stdin as Socket).unref();

	return {
		url,
		stop: async () => {
			await shutdown(pgCtl, c.directory, c.socket);
			watchdog.ref();
			watchdog.stdin.end();
			await exited;
		},
	};
};

const connection = (socket: string, user: string, settings: Record<string, string>) => {
	const port = settings['port'] ? `&port=${encodeURIComponent(settings['port'])}` : '';
	return `postgresql://${encodeURIComponent(user)}@localhost/postgres?host=${encodeURIComponent(socket)}${port}`;
};

// pg_ctl hands these to a shell, so every value is quoted. The socket settings come last to win.
// See -o in https://www.postgresql.org/docs/18/app-pg-ctl.html and
// https://www.postgresql.org/docs/18/runtime-config-connection.html#GUC-UNIX-SOCKET-PERMISSIONS
const flags = (socket: string, settings: Record<string, string>) =>
	Object.entries({
		...settings,
		listen_addresses: '',
		unix_socket_directories: socket,
		unix_socket_permissions: '0700',
	})
		.map(([key, value]) => `-c ${key}='${value.replaceAll("'", `'\\''`)}'`)
		.join(' ');
