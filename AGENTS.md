# AGENTS.md

portable-pg builds Postgres with pgvector as one movable directory for Linux, and ships a Node package that runs it. It is open source and meant to read obviously to a newcomer. Prefer plain TypeScript and plain bash over bespoke helpers, and names that state how they differ from their siblings. Keep names short.

## Project constraints

- **Rupee first.** Add extensions and platforms only when Rupee needs them.
- **Movable, old glibc.** Nothing in the directory may link outside it except glibc, and nothing may need a glibc newer than 2.34. `tests/linkage.test.ts` checks both.
- **Stable data format.** Within a Postgres major, never change a configure option that affects the on-disk format. See [docs/building.md](docs/building.md#the-data-format-rule).
- **Pinned everything.** Sources are pinned to commits, the base image to a digest, Actions to commit SHAs, dependencies to exact versions (`pnpm add -E`).
- **No runtime dependencies** in the Node package. Node's standard library and the system `tar` are enough.
- **Few tools.** Prefer GitHub's built-in features and hosted services over tools we maintain.
- **Licensing.** Prefer MIT, BSD or Apache dependencies. Flag GPL and AGPL before suggesting one. Never copy code or prose from other projects; credit ideas in the docs in our own words.

## Code style

### Symmetry

Code should be visually symmetric. Steps of an orchestrator, fields of a type, and files in a directory each sit at one level of abstraction and look alike. A piece that is smaller, longer, sparser or more complicated than its siblings usually means another level leaked in. Fix the level, not the look.

### Layout

- A blank line marks a shift in thinking. Lines that belong to one thought stay together.
- A guard gets a blank line after it.
- A short function stays compact. Don't spread a two- or three-line body over five lines.
- Order files most important first: constants, then exported entry points, then helpers. Shell scripts read the same way: a `main` near the top, helpers below.

### Control flow

- No `let`. Mutate a local array, iterate or recurse instead. In tests, use a Vitest fixture (`test.extend`).
- No `else if` or `else`. Write independent `if`s whose conditions are exclusive, or return early.
- No braces around a single one-line statement.

### Types

- Inference is fine. Name a type only when it's a contract someone has to follow, such as the options callers pass.
- Prefer built-in or narrower types. Don't derive types (`ReturnType<typeof fn>`, `Omit<...> & {...}`).

### Comments

Avoid comments. Names and structure should explain the code. The exception is a fact the code cannot show: an outside constraint, a tool's quirk. Every script starts with one line saying what it does and a `usage:` line. A short JSDoc on a public export is welcome.

## Commits

Conventional commits with a lower-case subject, enforced by commitlint. Body lines are at most 72 characters.

Before committing, run `pnpm format:check`, `pnpm lint`, `pnpm check` and `pnpm test`.
