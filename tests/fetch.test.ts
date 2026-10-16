import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test as base, expect, vi } from 'vitest';
import { fetchBinaries } from '#src/fetch';

const run = promisify(execFile);

type Fixtures = { root: string; source: { version: string; url: string; sha256: string } };

const test = base.extend<Fixtures>({
	root: async ({ onTestFinished }, use) => {
		const root = await mkdtemp(join(tmpdir(), 'ppg-fetch-'));
		onTestFinished(() => rm(root, { recursive: true, force: true }));
		await use(root);
	},
	source: async ({ root }, use) => {
		const tarball = await pack(root, '0.180600.0');
		const server = createServer((_, response) => response.end(tarball));
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

		const port = (server.address() as AddressInfo).port;
		const sha256 = createHash('sha256').update(tarball).digest('hex');
		await use({ version: '0.180600.0', url: `http://127.0.0.1:${port}/binaries.tar.gz`, sha256 });
		server.close();
	},
});

test('downloads, verifies and unpacks the binaries', async ({ root, source }) => {
	const directory = join(root, 'binaries');
	await fetchBinaries({ directory, source });

	expect(await readFile(join(directory, 'bin', 'postgres'), 'utf8')).toBe('postgres');
	expect(await readdir(root)).toEqual(['binaries', 'source']);
});

test('rejects a download whose checksum differs and leaves nothing behind', async ({
	root,
	source,
}) => {
	const directory = join(root, 'binaries');
	const wrong = { ...source, sha256: '0'.repeat(64) };

	await expect(fetchBinaries({ directory, source: wrong })).rejects.toThrow(/has SHA-256/);
	expect(await readdir(root)).toEqual(['source']);
});

test('ends with one directory when several processes fetch at once', async ({ root, source }) => {
	const directory = join(root, 'binaries');
	await Promise.all(Array.from({ length: 4 }, () => fetchBinaries({ directory, source })));

	expect(await readdir(root)).toEqual(['binaries', 'source']);
});

test('keeps binaries that are already there', async ({ root, source }) => {
	const directory = join(root, 'binaries');
	await fetchBinaries({ directory, source });
	await rm(join(directory, 'bin'), { recursive: true });

	const unreachable = { ...source, url: 'http://127.0.0.1:1/unreachable' };
	await fetchBinaries({ directory, source: unreachable });
	expect(existsSync(join(directory, 'bin'))).toBe(false);
});

test('refuses binaries of another version', async ({ root, source }) => {
	const directory = join(root, 'binaries');
	await fetchBinaries({ directory, source });

	const newer = { ...source, version: '0.180700.0' };
	await expect(fetchBinaries({ directory, source: newer })).rejects.toThrow(
		/holds portable-pg 0.180600.0, not 0.180700.0/,
	);
});

test('says when a version has no published binaries', async ({ root, source }) => {
	const unpublished = { ...source, sha256: undefined };

	await expect(
		fetchBinaries({ directory: join(root, 'binaries'), source: unpublished }),
	).rejects.toThrow(/no .*binaries/);
});

test("defaults to a directory per version in the user's cache", async ({ root, source }) => {
	vi.stubEnv('XDG_CACHE_HOME', join(root, 'cache'));

	expect(await fetchBinaries({ source })).toBe(join(root, 'cache', 'portable-pg', '0.180600.0'));
});

const pack = async (root: string, version: string) => {
	const source = join(root, 'source');
	const name = `portable-pg-${version}-linux-x64`;
	await mkdir(join(source, name, 'bin'), { recursive: true });
	await writeFile(join(source, name, 'bin', 'postgres'), 'postgres');
	await writeFile(join(source, name, 'manifest.json'), JSON.stringify({ version }));

	await run('tar', ['-czf', join(source, 'binaries.tar.gz'), '-C', source, name]);
	return readFile(join(source, 'binaries.tar.gz'));
};
