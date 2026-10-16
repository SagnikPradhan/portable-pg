# portable-pg

Postgres 18 with pgvector, built as one directory that runs from wherever you put it on Linux, and a small Node package that runs it for an app or a test suite. Nobody installs Postgres or Docker.

It is built for [Rupee](https://github.com/SagnikPradhan/rupee) first. Extensions and platforms are added when Rupee needs them.

## What you get

- Postgres 18, every contrib extension, and pgvector, with `psql`, `pg_dump`, `pg_restore` and `pg_upgrade`.
- Linux on x64 and arm64 with glibc 2.34 or newer: RHEL 9, Debian 12, Ubuntu 22.04 and anything newer.
- About 8 MB to download. Nothing outside the directory is needed besides glibc.

## Use it from Node

Needs Node 24. Install it with `pnpm add portable-pg`.

```ts
const server = await startServer({ directory: 'data/postgres' });
const pool = new pg.Pool({ connectionString: server.url });
await server.stop();
```

The options are documented in the types. Keep `portable-pg` external when bundling, since its watchdog runs from a separate file.

## Use the binaries

<details>
<summary>Download, check and run them like any Postgres install</summary>

```sh
v=0.180600.0
base=https://github.com/SagnikPradhan/portable-pg/releases/download/v$v
curl -fLO "$base/portable-pg-$v-linux-x64.tar.gz" -O "$base/SHA256SUMS"
sha256sum -c --ignore-missing SHA256SUMS
tar -xzf "portable-pg-$v-linux-x64.tar.gz"

pg=portable-pg-$v-linux-x64/bin
$pg/initdb -D data -U postgres --auth=trust
$pg/pg_ctl start -D data -l data/server.log
```

Every release file also has a build attestation: `gh attestation verify <file> -R SagnikPradhan/portable-pg`.

</details>

## More

[Building](docs/building.md) · [Testing](docs/testing.md) · [Releasing](docs/releasing.md) · [Contributing](.github/CONTRIBUTING.md)

MIT licensed. Postgres and pgvector are under the PostgreSQL License, with their notices in each tarball's `LICENSES/`.
