import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Stops the server on the data directory if it is ours, then removes the socket directory. Every
 * start gets its own socket directory, so a later server on the same data directory stays up.
 */
export const shutdown = async (pgCtl: string, directory: string, socket: string) => {
	// Fast mode rolls back open transactions and shuts down cleanly. See -m in
	// https://www.postgresql.org/docs/18/app-pg-ctl.html
	if (ours(directory, socket))
		await run(pgCtl, ['stop', '-m', 'fast', '-D', directory]).catch((error) => {
			if (ours(directory, socket))
				throw new Error(`Postgres did not stop on ${directory}`, { cause: error });
		});

	await rm(socket, { recursive: true, force: true });
};

const ours = (directory: string, socket: string) => {
	const file = join(directory, 'postmaster.pid');
	if (!existsSync(file)) return false;

	// The first line is the PID and the fifth the first socket directory. See
	// https://github.com/postgres/postgres/blob/REL_18_STABLE/src/include/utils/pidfile.h
	const lines = readFileSync(file, 'utf8').split('\n');
	return lines[4] === socket && alive(Number(lines[0]));
};

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
