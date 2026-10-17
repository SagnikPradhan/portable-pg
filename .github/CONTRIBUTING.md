# Contributing

Thanks for helping. portable-pg is built for [Rupee](https://github.com/SagnikPradhan/rupee) first, so open an issue before working on a new extension or platform, to check it fits.

## Setup

You need Node 24 and pnpm, and Docker with buildx on Linux or Apple's command line tools on a Mac (`corepack enable` provides the pinned version).

```sh
pnpm install
pnpm postgres   # builds vendor/postgres/<platform>, about a minute and a half
pnpm test
```

## Where things are

- `scripts/postgres.sh`, `scripts/postgres/`: the build. See [docs/building.md](../docs/building.md).
- `src/`: the Node package and the `ppg` command.
- `tests/`: every test, for the binaries and the Node package. See [docs/testing.md](../docs/testing.md).
- `scripts/release.sh` and `.github/workflows/`: CI and releases. See [docs/releasing.md](../docs/releasing.md).

## Changes

- Run `pnpm format:check && pnpm lint && pnpm check && pnpm test` before pushing. `pnpm test` covers the binaries too, so rebuild them first with `pnpm postgres` if you touched the build.
- Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org) with a lower-case subject, such as `feat(build): add pg_uuidv7`. Pull requests are squash merged, so the title becomes the commit.
- Code style is described in [AGENTS.md](../AGENTS.md).
