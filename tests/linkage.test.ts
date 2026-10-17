import { existsSync } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { test as base, expect } from 'vitest';
import { BINARIES, shell } from './postgres.ts';

// Compiled programs and libraries start with these bytes: ELF files on Linux, 64-bit Mach-O files on
// macOS. The rest of bin and lib is scripts, SQL and extension control files.
// ELF: e_ident in https://man7.org/linux/man-pages/man5/elf.5.html
// Mach-O: MH_MAGIC_64 in https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h
const LINUX = {
	magic: '\x7fELF',
	floor: { name: 'glibc', version: '2.34' },
	system: /^(libc|libm|libdl|libpthread|librt|ld-linux-[a-z0-9_-]+|linux-vdso|linux-gate)\.so/,
	inspect: async (files: string[]) => ({
		outside: (await Promise.all(files.map(resolvedByLdd))).flat(),
		needs: (await Promise.all(files.map(glibcVersions))).flat(),
	}),
};

const DARWIN = {
	magic: '\xcf\xfa\xed\xfe',
	floor: { name: 'macOS', version: '26.0' },
	system: /^\/usr\/lib\/(libSystem\.B\.dylib|dyld)$/,
	inspect: async (files: string[]) => {
		const commands = await loadCommands(files);
		return { outside: commands.flatMap(linkedOutside), needs: commands.flatMap(macosVersions) };
	},
};

const SYSTEM = process.platform === 'darwin' ? DARWIN : LINUX;
const FLOOR = `${SYSTEM.floor.name} ${SYSTEM.floor.version}`;

// Reads every binary once for both tests, since otool is slow to start on macOS. Vitest requires a
// fixture's first parameter to be destructured, even when it needs no other fixture.
const test = base.extend<{
	binaries: string[];
	inspected: { outside: string[]; needs: { file: string; version: string }[] };
}>({
	// eslint-disable-next-line no-empty-pattern
	binaries: [async ({}, use) => use(await compiled()), { scope: 'file' }],
	inspected: [async ({ binaries }, use) => use(await SYSTEM.inspect(binaries)), { scope: 'file' }],
});

test('every binary finds its libraries inside the directory or in the system', ({
	binaries,
	inspected,
}) => {
	expect(binaries).not.toEqual([]);
	expect(inspected.outside).toEqual([]);
});

test(`no binary needs a system newer than ${FLOOR}`, ({ inspected }) => {
	expect(inspected.needs).not.toEqual([]);
	const newer = inspected.needs.filter(({ version }) => isNewer(version, SYSTEM.floor.version));

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

// macOS has no ldd. otool -l prints each file's load commands under a line naming it: the libraries it
// loads as `name`, its run paths as `path` and the oldest macOS it runs on as `minos`. One call reads
// every file, because each otool start goes through xcrun and takes a while. See `man otool`.
// Only libSystem, which holds the C library, and the loader itself may come from the system.
const loadCommands = async (files: string[]) => {
	const parts = (await shell('otool', '-l', ...files)).split(/^(\/.*):$/m).slice(1);
	const sections = new Map(
		parts.flatMap((part, index) => (index % 2 ? [] : [[part, parts[index + 1]]])),
	);
	return files.map((file) => ({ file, commands: sections.get(file) ?? '' }));
};

// A library named @rpath/<name> is found through a run path, which must be @loader_path/../lib.
// See `man dyld`.
const linkedOutside = ({ file, commands }: { file: string; commands: string }) => {
	const names = [...commands.matchAll(/^\s*name (\S+) \(offset/gm)].map((m) => m[1] ?? '');
	const paths = [...commands.matchAll(/^\s*path (\S+) \(offset/gm)].map((m) => m[1] ?? '');
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

const macosVersions = ({ file, commands }: { file: string; commands: string }) =>
	[...commands.matchAll(/^\s*minos (\S+)/gm)].map((m) => ({
		file: relative(BINARIES, file),
		version: m[1] ?? '',
	}));

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
