import { existsSync } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import { BINARIES, shell } from './postgres.ts';

// Compiled programs and libraries start with these bytes: ELF files on Linux, 64-bit Mach-O files on
// macOS. The rest of bin and lib is scripts, SQL and extension control files.
// ELF: e_ident in https://man7.org/linux/man-pages/man5/elf.5.html
// Mach-O: MH_MAGIC_64 in https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h
const LINUX = {
	magic: '\x7fELF',
	floor: { name: 'glibc', version: '2.34' },
	system: /^(libc|libm|libdl|libpthread|librt|ld-linux-[a-z0-9_-]+|linux-vdso|linux-gate)\.so/,
	outside: (file: string) => resolvedByLdd(file),
	needs: (file: string) => glibcVersions(file),
};

const DARWIN = {
	magic: '\xcf\xfa\xed\xfe',
	floor: { name: 'macOS', version: '26.0' },
	system: /^\/(usr\/lib|System\/Library)\//,
	outside: (file: string) => linkedByOtool(file),
	needs: (file: string) => macosVersions(file),
};

const SYSTEM = process.platform === 'darwin' ? DARWIN : LINUX;
const FLOOR = `${SYSTEM.floor.name} ${SYSTEM.floor.version}`;

test('every binary finds its libraries inside the directory or in the system', async () => {
	const outside = await Promise.all((await compiled()).map(SYSTEM.outside));

	expect(outside.flat()).toEqual([]);
});

test(`no binary needs a system newer than ${FLOOR}`, async () => {
	const needs = await Promise.all((await compiled()).map(SYSTEM.needs));
	const newer = needs.flat().filter(({ version }) => isNewer(version, SYSTEM.floor.version));

	expect(newer.map(({ file, version }) => `${file} needs ${SYSTEM.floor.name} ${version}`)).toEqual(
		[],
	);
});

// ldd prints where the loader resolves each library. See https://man7.org/linux/man-pages/man1/ldd.1.html
const resolvedByLdd = async (file: string) => {
	const resolved = (await shell('ldd', file)).split('\n').filter((line) => line.includes('=>'));
	const pairs = resolved.map((line) => line.trim().split(/\s+/));

	return pairs
		.filter(
			([name = '', , path = '']) => !LINUX.system.test(name) && !path.startsWith(`${BINARIES}/`),
		)
		.map(([name, , path]) => `${relative(BINARIES, file)} resolves ${name} to ${path}`);
};

// macOS has no ldd. otool -L lists what a file loads, after a line naming the file, and otool -l its run
// paths. A library named @rpath/<name> is found through a run path, which must be @loader_path/../lib.
// See `man otool` and `man dyld`.
const linkedByOtool = async (file: string) => {
	const libraries = (await shell('otool', '-L', file)).split('\n').slice(1);
	const names = libraries.map((line) => line.trim().split(' ')[0] ?? '');
	const paths = [...(await shell('otool', '-l', file)).matchAll(/^\s*path (\S+)/gm)].map(
		(m) => m[1],
	);
	const inside = (name: string) =>
		name.startsWith('@rpath/') && existsSync(join(BINARIES, 'lib', name.slice('@rpath/'.length)));

	return [
		...names
			.filter((name) => !DARWIN.system.test(name) && !inside(name))
			.map((name) => `${relative(BINARIES, file)} loads ${name}`),
		...paths
			.filter((path) => path !== '@loader_path/../lib')
			.map((path) => `${relative(BINARIES, file)} searches ${path}`),
	];
};

// objdump -T lists the versioned glibc symbols a binary needs, such as GLIBC_2.34. See
// https://sourceware.org/binutils/docs/binutils/objdump.html
const glibcVersions = async (file: string) => {
	const versions = (await shell('objdump', '-T', file)).match(/GLIBC_[\d.]+/g) ?? [];

	return [...new Set(versions)].map((version) => ({
		file: relative(BINARIES, file),
		version: version.slice('GLIBC_'.length),
	}));
};

// otool -l prints the oldest macOS a file runs on as `minos` in its LC_BUILD_VERSION.
const macosVersions = async (file: string) => {
	const versions = [...(await shell('otool', '-l', file)).matchAll(/^\s*minos (\S+)/gm)];

	return versions.map((m) => ({ file: relative(BINARIES, file), version: m[1] ?? '' }));
};

const isNewer = (version: string, floor: string) => {
	const [major = 0, minor = 0] = version.split('.').map(Number);
	const [floorMajor = 0, floorMinor = 0] = floor.split('.').map(Number);
	return major > floorMajor || (major === floorMajor && minor > floorMinor);
};

const compiled = async () => {
	const entries = await Promise.all(['bin', 'lib'].map((dir) => files(join(BINARIES, dir))));
	const flags = await Promise.all(entries.flat().map(isCompiled));
	return entries.flat().filter((_, index) => flags[index]);
};

const files = async (directory: string) =>
	(await readdir(directory, { recursive: true, withFileTypes: true }))
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name));

const isCompiled = async (file: string) => {
	const handle = await open(file);
	const header = Buffer.alloc(4);
	await handle.read(header, 0, 4, 0);
	await handle.close();
	return header.toString('latin1') === SYSTEM.magic;
};
