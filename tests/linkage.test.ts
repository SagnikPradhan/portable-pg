import { open, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import { BINARIES, shell } from './postgres.ts';

const GLIBC = [2, 34];
const SYSTEM = /^(libc|libm|libdl|libpthread|librt|ld-linux-[a-z0-9_-]+|linux-vdso|linux-gate)\.so/;

test('every binary finds its libraries inside the directory or in glibc', async () => {
	const outside = await Promise.all((await compiled()).map(libraries));

	expect(outside.flat()).toEqual([]);
});

test('no binary needs a glibc newer than 2.34', async () => {
	const newer = await Promise.all((await compiled()).map(glibc));

	expect(newer.flat()).toEqual([]);
});

// ldd prints where the loader resolves each library. See https://man7.org/linux/man-pages/man1/ldd.1.html
const libraries = async (file: string) => {
	const resolved = (await shell('ldd', file)).split('\n').filter((line) => line.includes('=>'));
	const pairs = resolved.map((line) => line.trim().split(/\s+/));

	return pairs
		.filter(([name = '', , path = '']) => !SYSTEM.test(name) && !path.startsWith(`${BINARIES}/`))
		.map(([name, , path]) => `${relative(BINARIES, file)} resolves ${name} to ${path}`);
};

// objdump -T lists the versioned glibc symbols a binary needs, such as GLIBC_2.34. See
// https://sourceware.org/binutils/docs/binutils/objdump.html
const glibc = async (file: string) => {
	const versions = (await shell('objdump', '-T', file)).match(/GLIBC_[\d.]+/g) ?? [];

	return [...new Set(versions)]
		.filter((version) => newer(version.slice('GLIBC_'.length)))
		.map((version) => `${relative(BINARIES, file)} needs ${version}`);
};

const newer = (version: string) => {
	const [major = 0, minor = 0] = version.split('.').map(Number);
	return major > GLIBC[0]! || (major === GLIBC[0] && minor > GLIBC[1]!);
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

// Compiled programs and libraries on Linux are ELF files, which start with these four bytes. The rest
// of bin and lib is scripts, SQL and extension control files, which ldd and objdump cannot read.
// See e_ident in https://man7.org/linux/man-pages/man5/elf.5.html
const isCompiled = async (file: string) => {
	const handle = await open(file);
	const header = Buffer.alloc(4);
	await handle.read(header, 0, 4, 0);
	await handle.close();
	return header.toString('latin1') === '\x7fELF';
};
