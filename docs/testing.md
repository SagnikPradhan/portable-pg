# How releases are tested

Every pull request builds every platform and runs every test below on each. A release runs the same workflow on its tag and publishes only what passed.

All tests are Vitest tests and run with `pnpm test`, against the binaries in `vendor/postgres/<platform>` or the directory in `PPG_BINARIES`. They run a real Postgres, never a mock. On Linux, `pnpm test` needs Docker.

- **`tests/smoke.test.ts`** creates every extension, queries an HNSW index and restores a dump. It runs once from a copy of the binaries in a different path than they were built in, which proves they are movable, and on Linux once more in a container of AlmaLinux 9, Debian 12, Ubuntu 22.04 and Debian 13. The containers run as the unprivileged `nobody` user, because Postgres refuses to run as root, and the tests drive them with `docker exec`.
- **`tests/linkage.test.ts`** checks that every binary finds its libraries inside the directory or in the system, and needs no system newer than the platform's floor: glibc 2.34 or macOS 26. On Linux it reads what the loader actually resolves, using `ldd`, rather than what each binary asks for, so it also catches a library silently picked up from the host system. macOS has no `ldd`, so there it reads each binary's libraries and run paths with `otool`.
- **`tests/compat.test.ts`** opens a data directory that the previous release created and wrote to. It needs that release's binaries in `PPG_PREVIOUS` and skips without them. CI downloads them, and notes when there is no previous release for the platform yet. To run it locally:

  ```sh
  mkdir -p /tmp/previous
  gh release download --pattern '*-linux-x64.tar.gz' -O - -R SagnikPradhan/portable-pg | tar -xz -C /tmp/previous --strip-components=1
  PPG_PREVIOUS=/tmp/previous pnpm test tests/compat.test.ts
  ```

- **`tests/server.test.ts`** covers starting, stopping, settings and crash recovery. Its watchdog test kills a Node process with SIGKILL and waits for its Postgres to stop.
- **`tests/fetch.test.ts`** covers downloads, checksum failures, concurrent fetches and version mismatches, against a local HTTP server.

Before pushing, run what CI's check job runs, then the tests:

```sh
pnpm format:check && pnpm lint && pnpm check && pnpm test
```
