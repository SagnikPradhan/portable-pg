# How the binaries are built

`scripts/postgres.sh [x64|arm64]` builds one platform in Docker and leaves two things in `vendor/postgres/`: the unpacked directory `linux-<arch>`, and the release tarball `portable-pg-<version>-linux-<arch>.tar.gz`. A cold build takes about a minute and a half on 12 cores.

```sh
pnpm postgres         # this machine's architecture
pnpm postgres arm64   # another one, through Docker's emulation if it is set up
```

The work happens in `scripts/postgres/build.sh`, inside `scripts/postgres/Dockerfile`. Each choice below exists to keep the directory movable and runnable on as many Linux machines as possible.

## Old glibc, current compiler

A binary runs only on a glibc at least as new as the one it was linked against. The build runs on AlmaLinux 9, whose glibc 2.34 sets the floor: RHEL 9, Debian 12, Ubuntu 22.04 and everything after. Python's manylinux_2_34 wheels draw the line in the same place. Older glibc versions made up about 2% of Python package downloads in October 2026, so they are not worth building for.

`gcc-toolset-13` brings a newer compiler than the system's gcc 11, and still links against the system glibc. On AlmaLinux 8, whose own gcc was version 8, building a pgvector index ran about 1.5 times slower without it. Moving the build from AlmaLinux 8 to 9 with the same compiler changed no benchmark by more than its noise: pgbench throughput was equal, and HNSW builds and searches were within 2%.

The base image is pinned by digest, and Renovate updates it.

## Pinned sources

`scripts/postgres/versions.env` names the Postgres and pgvector release tags and the commit each tag points to. The build clones each tag and stops if it does not land on that commit, so a moved tag cannot change what gets built. Renovate opens a pull request when either project tags a release, updating the tag and commit together. It never proposes a new Postgres major.

Building from git rather than the release tarball costs about five seconds, because bison and flex regenerate the parsers.

## Nothing outside the directory

- **Libraries.** Postgres is configured `--without-icu --without-readline --without-zlib`, and without OpenSSL, Kerberos or LDAP, so it links against nothing but glibc and its own `lib/`.
- **Finding `lib/`.** Every binary carries the run path `$ORIGIN/../lib`, which the loader resolves relative to the binary itself. Postgres finds `share/` relative to its binary too. Together they let the directory move anywhere.
- **Any CPU.** pgvector compiles with `-march=native` unless told otherwise, which ties it to the build machine's CPU. `OPTFLAGS=""` turns that off.
- **Size.** Headers, static libraries and the extension build kit are removed, and binaries are stripped.

## The data format rule

Some configure options change how Postgres lays out data on disk: block size, WAL segment size, the collation provider. Changing one would leave existing data directories unreadable. **Within a Postgres major, no configure option that affects the data format changes.** Such changes wait for the next major, when users run `pg_upgrade` anyway. CI enforces the result: every release must open a data directory the previous release created.

## The manifest

`build.sh` runs in two steps. `compile` builds everything. `describe` then writes `manifest.json` with the version, platform, source commit, the Postgres and pgvector commits, and every extension with its version. Only `describe` depends on the version and commit, so Docker's cache keeps the compile across commits that don't touch the build.

## Adding an extension

1. Add its tag and commit to `scripts/postgres/versions.env`, and a matching regex manager to `.github/renovate.json`.
2. Clone and build it in `build.sh`, after Postgres, against `$PREFIX/bin/pg_config`.
3. Copy its license into `LICENSES/`.
4. The smoke test creates every installed extension, so it is covered once it builds. Add a test to `tests/smoke.test.ts` if the extension needs more than `CREATE EXTENSION` to prove it works.
5. Release it as a minor version: `yy` goes up.
