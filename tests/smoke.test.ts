import { test as base, describe, expect } from 'vitest';
import { cluster, container, host, type Cluster } from './postgres.ts';

const MOVED = 'a different path';
const DISTROS = ['almalinux:9', 'debian:12', 'ubuntu:22.04', 'debian:13'];

const test = base.extend<{ place: string; postgres: Cluster }>({
	place: MOVED,
	postgres: async ({ place }, use) => {
		const machine = place === MOVED ? await host() : await container(place);
		const postgres = cluster(machine);
		await postgres.init();
		await postgres.start();

		await use(postgres);
		await machine.remove();
	},
});

describe.concurrent.each([MOVED, ...DISTROS])('from %s', (place) => {
	test.scoped({ place });

	test('creates every extension', async ({ postgres }) => {
		const names = (await postgres.sql('select name from pg_available_extensions')).split('\n');
		for (const name of names)
			await postgres.sql(`create extension if not exists "${name}" cascade`);

		expect(names).toContain('vector');
		expect(await postgres.sql('select count(*) from pg_extension')).toBe(String(names.length));
	});

	test('answers nearest-neighbour queries from an HNSW index', async ({ postgres }) => {
		await postgres.sql('create extension vector');
		await postgres.sql(
			'create table items as select i as id, array[random(), random(), random()]::vector(3) as embedding from generate_series(1, 1000) i',
		);
		await postgres.sql('create index on items using hnsw (embedding vector_l2_ops)');

		const nearest = "select id from items order by embedding <-> '[0.5,0.5,0.5]' limit 10";
		expect(await postgres.sql(`set enable_seqscan = off; explain ${nearest}`)).toContain(
			'items_embedding_idx',
		);
		expect(await postgres.sql(`set enable_seqscan = off; ${nearest}`)).toMatch(/^(\d+\n){9}\d+$/);
	});

	test('restores a dump into another database', async ({ postgres }) => {
		const dump = `${postgres.work}/dump`;
		await postgres.sql('create table kept as select generate_series(1, 1000) as i');
		await postgres.client('pg_dump', '-Fc', '-f', dump, 'postgres');

		await postgres.client('createdb', 'restored');
		await postgres.client('pg_restore', '-d', 'restored', dump);
		expect(await postgres.sql('select count(*) from kept', 'restored')).toBe('1000');
	});
});
