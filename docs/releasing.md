# How to cut a release

Releases happen when a tag is pushed. There is no release bot and no version file to edit: the tag is the version.

## Pick the version

A version reads `a.18xxyy.z`:

- `a` goes up for anything that breaks: a change to the Node package's API, or a Postgres major that needs `pg_upgrade` on existing data. It stays `0` until portable-pg runs Rupee in production.
- `18xx` is the Postgres inside, with the minor release padded to two digits: `1806` is Postgres 18.6.
- `yy` counts our additions on that Postgres, such as a new extension.
- `z` counts fixes.

Compare `main` with the last release and take the first row that applies:

| Since the last release                                               | Bump   | Example                     |
| -------------------------------------------------------------------- | ------ | --------------------------- |
| The Node package's API changed incompatibly, or a new Postgres major | `a`    | `0.180700.2` → `1.180700.0` |
| Postgres moved to a new minor release                                | `18xx` | `0.180601.3` → `0.180700.0` |
| Something was added: an extension, an option                         | `yy`   | `0.180600.4` → `0.180601.0` |
| Only fixes                                                           | `z`    | `0.180601.0` → `0.180601.1` |

## Tag it

```sh
git switch main && git pull
git tag v0.180601.0
git push origin v0.180601.0
```

The release workflow then:

1. checks the tag has the form `va.18xxyy.z`;
2. builds both architectures and runs every test, through the same workflow pull requests use;
3. packs the Node package with the tarballs' checksums built in, and writes `SHA256SUMS` and a manifest for each platform;
4. checks the tag's `18xx` matches the Postgres it built;
5. attests every file and creates the GitHub release, with notes generated from the merged pull requests.

The release publishes the exact files the tests ran against. Nothing is rebuilt after testing.

## When a release is broken

Fix it on `main` and release the fix as the next version. Then add a line at the top of the broken release's notes: "⚠️ Broken, use vX.Y.Z instead." Don't delete the release or its files, because projects that pinned its URLs would stop installing.
