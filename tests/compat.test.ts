import { realpathSync } from 'node:fs';
import { test as base, expect } from 'vitest';
import { cluster, host, type Machine } from './postgres.ts';

const previous = process.env['PPG_PREVIOUS'];

const test = base.extend<{ machine: Machine }>({
	machine: async ({ onTestFinished }, use) => {
		const machine = await host();
		onTestFinished(machine.remove);
		await use(machine);
	},
});

test.skipIf(!previous)(
	'opens a data directory the previous release created and wrote to',
	async ({ machine }) => {
		const old = cluster(machine, realpathSync(previous!));
		await old.init();
		await old.start();
		await old.sql(
			'create extension vector; create table kept as select i, array[i, i, i]::vector(3) as v from generate_series(1, 100) i; create index on kept using hnsw (v vector_l2_ops)',
		);
		await old.stop();

		const current = cluster(machine);
		await current.start();
		const nearest = "set enable_seqscan = off; select i from kept order by v <-> '[1,1,1]' limit 1";
		expect(await current.sql(nearest)).toBe('1');
	},
);
