import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const REPOSITORY = 'https://github.com/SagnikPradhan/portable-pg';
const SUPPORTED = ['linux-x64', 'linux-arm64'];

const run = promisify(execFile);

/** Where binaries go and come from. Both default to this version's own. */
export type FetchOptions = {
	/** Where the binaries go. Defaults to a directory per version in the user's cache. */
	directory?: string | undefined;
	/** Where to download them from. Defaults to this version's GitHub release. */
	source?: Source | undefined;
};

/** A tarball of binaries, the SHA-256 it must have and the version inside it. */
export type Source = { version: string; url: string; sha256: string | undefined };

/** Downloads binaries unless they are there already, and returns their directory. */
export const fetchBinaries = async (o: FetchOptions = {}) => {
	const source = o.source ?? (await release());
	const directory = o.directory ?? join(cache(), source.version);

	if (!installed(directory)) await download(directory, source);
	await verify(directory, source.version);
	return directory;
};

const release = async (): Promise<Source> => {
	const version = (await json('package.json')).version;
	const sha256 = (await json('checksums.json'))[platform()];
	const name = `portable-pg-${version}-${platform()}.tar.gz`;

	return { version, sha256, url: `${REPOSITORY}/releases/download/v${version}/${name}` };
};

const download = async (directory: string, source: Source) => {
	if (!source.sha256) throw new Error(unpublished(source.version));

	const bytes = await get(source.url);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	if (sha256 !== source.sha256)
		throw new Error(`${source.url} has SHA-256 ${sha256}, not ${source.sha256}`);

	await mkdir(dirname(directory), { recursive: true });
	const staging = await mkdtemp(`${directory}.download-`);
	try {
		await unpack(bytes, staging);
		await rename(staging, directory).catch((error: unknown) => {
			if (!installed(directory)) throw error;
		});
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
};

const verify = async (directory: string, version: string) => {
	const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
	if (manifest.version === version) return;

	throw new Error(
		`${directory} holds portable-pg ${manifest.version}, not ${version}. Delete it to fetch ${version}.`,
	);
};

const installed = (directory: string) => existsSync(join(directory, 'manifest.json'));

const cache = () => join(process.env['XDG_CACHE_HOME'] || join(homedir(), '.cache'), 'portable-pg');

const get = async (url: string) => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Downloading ${url} failed with ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
};

const unpack = async (bytes: Buffer, directory: string) => {
	const archive = join(directory, 'archive.tar.gz');
	await writeFile(archive, bytes);
	await run('tar', ['-xzf', archive, '-C', directory, '--strip-components=1']);
	await rm(archive);
};

// Node reports a glibc version only when it runs on glibc. See
// https://nodejs.org/docs/latest-v24.x/api/report.html
const platform = () => {
	const header = process.report.getReport() as { header: { glibcVersionRuntime?: string } };
	const libc = header.header.glibcVersionRuntime ? '' : '-musl';
	return `${process.platform}-${process.arch}${process.platform === 'linux' ? libc : ''}`;
};

const unpublished = (version: string) =>
	SUPPORTED.includes(platform())
		? `portable-pg ${version} has no published binaries. Build them with scripts/postgres.sh.`
		: `portable-pg has no binaries for ${platform()}, only for ${SUPPORTED.join(' and ')}.`;

const json = async (file: string) =>
	JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
