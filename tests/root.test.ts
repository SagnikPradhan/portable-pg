import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { test as base, expect } from 'vitest';
import { BINARIES } from './postgres.ts';

const IMAGE = 'node:24-bookworm-slim';
const LINUX = process.platform === 'linux';

// Linux runs Node as root in a container. A Mac has no containers, so it runs Node under sudo.
const PKG = LINUX ? '/pkg' : process.cwd();
const WORK = LINUX ? '/work' : '';

// On a Mac nobody cannot enter the checkout or the user's own temporary directory.
const SHARED = LINUX ? tmpdir() : '/tmp';

const OTHER = LINUX ? { uid: 1000, gid: 1000 } : { uid: userInfo().uid, gid: userInfo().gid };

const exec = promisify(execFile);

type Fixtures = { bin: string; inRoot: (script: string) => Promise<Record<string, unknown>> };

const fixtures = base.extend<Fixtures>({
	bin: [
		// eslint-disable-next-line no-empty-pattern
		async ({}, use) => {
			if (LINUX) return use('/opt/postgres');

			const copy = await mkdtemp(join(SHARED, 'ppg-root-bin-'));
			await chmod(copy, 0o755);
			await cp(BINARIES, copy, { recursive: true });
			await use(copy);
			await rm(copy, { recursive: true, force: true });
		},
		{ scope: 'file' },
	],
	inRoot: async ({ bin, onTestFinished }, use) => {
		const work = await mkdtemp(join(SHARED, 'ppg-root-'));
		onTestFinished(() => rm(work, { recursive: true, force: true }));
		await chmod(work, 0o755);

		await use(async (script) => {
			const code = prelude(LINUX ? WORK : work, bin) + script;
			const { stdout } = LINUX ? await docker(work, bin, code) : await sudo(code);
			return JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
		});
	},
});

// CI never skips, so it cannot lose these quietly.
const passwordless = await exec('sudo', ['-n', 'true']).then(
	() => true,
	() => false,
);
const test = fixtures.skipIf(!LINUX && !passwordless && !process.env['CI']);

const docker = (work: string, bin: string, code: string) =>
	exec('docker', [
		...['run', '--rm', '--user', '0:0', '-v', `${work}:${WORK}`],
		...['-v', `${process.cwd()}:${PKG}:ro`, '-v', `${BINARIES}:${bin}:ro`, IMAGE],
		...['node', '--input-type=module', '-e', code],
	]);

const sudo = (code: string) =>
	exec('sudo', ['-n', 'env', 'TMPDIR=/tmp', process.execPath, '--input-type=module', '-e', code]);

// Every script ends by printing one JSON line and leaves its work directory empty, since root made it.
const prelude = (work: string, bin: string) => `
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startServer } from '${PKG}/src/server.ts';
const binaries = '${bin}';
const work = '${work}';
const nobody = Number(execFileSync('id', ['-u', 'nobody'], { encoding: 'utf8' }));
const owner = (path) => statSync(path).uid;
const sql = (url, text) => execFileSync('${bin}/bin/psql', ['-XAtq', '-d', url, '-c', text], { encoding: 'utf8' }).trim();
const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith('ppg-'));
const finish = (result) => { for (const name of readdirSync(work)) rmSync(work + '/' + name, { recursive: true, force: true }); console.log(JSON.stringify({ ...result, nobody })); };
`;

test('starts as root and runs Postgres as nobody', async ({ inRoot }) => {
	const result = await inRoot(`
		const directory = work + '/data';
		const server = await startServer({ directory, binaries });
		const user = sql(server.url, 'select current_user');
		const dataOwner = owner(directory);
		await server.stop();
		finish({ user, dataOwner });
	`);

	expect(result).toMatchObject({ user: 'postgres', dataOwner: result['nobody'] });
});

test('removes the socket and the temporary data directory on stop as root', async ({ inRoot }) => {
	const result = await inRoot(`
		const before = leftovers();
		const server = await startServer({ binaries });
		await server.stop();
		finish({ before, after: leftovers() });
	`);

	expect(result['after']).toEqual(result['before']);
});

test('runs Postgres as the user and group in runAs', async ({ inRoot }) => {
	const result = await inRoot(`
		const directory = work + '/data';
		const server = await startServer({ directory, binaries, runAs: ${JSON.stringify(OTHER)} });
		const stats = statSync(directory);
		await server.stop();
		finish({ uid: stats.uid, gid: stats.gid });
	`);

	expect(result).toMatchObject(OTHER);
});

test('refuses a data directory root owns and says who should', async ({ inRoot }) => {
	const result = await inRoot(`
		const directory = work + '/data';
		await (await startServer({ directory, binaries })).stop();
		execFileSync('chown', ['-R', '0:0', directory]);
		const error = await startServer({ directory, binaries }).catch((e) => e);
		finish({ code: error.code, message: error.message });
	`);

	expect(result).toMatchObject({
		code: 'DATA_DIRECTORY_OWNER',
		message: expect.stringMatching(
			new RegExp(`is owned by 0, not ${result['nobody']}.*chown`, 's'),
		),
	});
});

test('keeps the default binaries where nobody can run them', async ({ inRoot }) => {
	const releases = dirname(BINARIES);
	const tarball = join(
		releases,
		(await readdir(releases)).find((name) => name.endsWith('.tar.gz')) ?? '',
	);
	const sha256 = createHash('sha256')
		.update(await readFile(tarball))
		.digest('hex');
	const { version } = JSON.parse(await readFile(join(BINARIES, 'manifest.json'), 'utf8'));
	const served = join(PKG, relative(process.cwd(), tarball));

	const result = await inRoot(`
		const { createServer } = await import('node:http');
		const { readFileSync } = await import('node:fs');
		const { fetchBinaries } = await import('${PKG}/src/fetch.ts');
		delete process.env.XDG_CACHE_HOME;
		const server = createServer((_, response) => response.end(readFileSync('${served}')));
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const url = 'http://127.0.0.1:' + server.address().port + '/binaries.tar.gz';
		const cached = await fetchBinaries({ source: { version: '${version}', url, sha256: '${sha256}' } });
		const running = await startServer({ binaries: cached });
		const user = sql(running.url, 'select current_user');
		await running.stop();
		server.close();
		rmSync(cached, { recursive: true, force: true });
		finish({ user });
	`);

	expect(result).toMatchObject({ user: 'postgres' });
});
