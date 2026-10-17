#!/bin/bash
# Builds one platform's binaries into vendor/postgres/<platform> and packs them as a release tarball.
# usage: scripts/postgres.sh [linux-x64|linux-arm64|darwin-arm64] [extra flags for the platform's build...]
# VERSION overrides the version from package.json, as a release does from its tag.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
# shellcheck source=scripts/postgres/versions.env
source scripts/postgres/versions.env
set +a

PLATFORM=${1:-$(node -p 'process.platform + "-" + process.arch')}
VERSION=${VERSION:-$(node -p "require('./package.json').version")}
SOURCE=$(git rev-parse --verify -q HEAD || echo unknown)
OUT=vendor/postgres/$PLATFORM
NAME=portable-pg-$VERSION-$PLATFORM
export PLATFORM VERSION SOURCE OUT

main() {
	[[ $PLATFORM =~ ^(linux-x64|linux-arm64|darwin-arm64)$ ]] || {
		echo "unsupported platform: $PLATFORM" >&2
		exit 1
	}

	rm -rf "$OUT"
	mkdir -p vendor/postgres
	"scripts/postgres/${PLATFORM%-*}.sh" "${@:2}"
	chmod 755 "$OUT"

	pack
	echo "vendor/postgres/$NAME.tar.gz"
}

# The tarball holds one directory named after the release. Renaming it while packing would need GNU
# tar's --transform or BSD tar's -s, so it moves there and back instead.
pack() {
	local staging
	staging=$(mktemp -d)
	mv "$OUT" "$staging/$NAME"
	tar -C "$staging" -czf "vendor/postgres/$NAME.tar.gz" "$NAME"
	mv "$staging/$NAME" "$OUT"
	rmdir "$staging"
}

main "$@"
